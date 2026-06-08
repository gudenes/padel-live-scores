# Premium Notifications — Plan 2A: Generic Event-Notify Pipeline + First Sender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable pipeline that lets *non-match, entity-scoped* events fan out through the existing tier gate, and prove it end-to-end by shipping the first real free sender — **`tournament_starting`** (notify followers of a tournament when it begins).

**Architecture:** A new internal endpoint `POST /api/push/notify-event` accepts `{ category, entityType, entityId, title, body, url?, metadata?, icon? }`, resolves recipients via a shared `resolveEntityFollowers()` helper (followers from `user_bookmarks`, plus anon devices for player/match), applies the **same** tier gate + prefs + mute + dedup as the match route, and delivers through the existing `sendPush` / `sendPushToFcmTokens` / `user_notifications` helpers. A padelgod client helper `notifyEvent()` (mirroring `notifyLiveTransition`) POSTs to it. Idempotency uses per-row marker columns where an owning row exists (`tournaments.starting_notified_at`) and a generic `notification_events_sent` sent-log for many-to-one events (used by Plan 2B). A new padelgod worker `tournament-start-notifier` detects the `starts_at` edge.

**Tech Stack:** Next.js 16 App Router (Route Handlers), TypeScript, Supabase (Postgres, service-role client), padelgod (Node cron workers on Railway), Vitest. Migrations via `node scripts/apply-migration.mjs <file>` (pg driver; `psql` not installed; `.env.local` provides `DATABASE_URL`).

**Spec:** `docs/superpowers/specs/2026-06-08-premium-notifications-design.md` · **Plan 1 (merged):** `docs/superpowers/plans/2026-06-08-premium-notifications-foundation.md`

**Conventions (AGENTS.md):** breaking-change Next.js — skim `node_modules/next/dist/docs/` before route work. The worktree already has `.env.local`; run `npm install` once before building/testing (fresh worktree). Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Key facts from the codebase map (read before starting)

- **`/api/push/notify` (`src/app/api/push/notify/route.ts`)** — auth `Bearer $CRON_SECRET` (line ~230); resolves recipients from `user_bookmarks` (`bookmark_type='match'` and `='player'`); per recipient applies `if (!shouldDeliverToRecipient(category, isPro)) continue` then `resolvePrefs` + mute, inserts `user_notifications` (always-on inbox) and pushes via `sendPush` (web) + `sendPushToFcmTokens` (FCM from `native_push_subscriptions`); anon path via `anon_bookmarks` → `anon_push_subscriptions`.
- **Delivery helpers (reuse, do not reimplement):**
  - `src/lib/push.ts` → `sendPush(subscription, payload): Promise<boolean>` (false ⇒ stale 410/404).
  - `src/lib/push-fcm.ts` → `sendPushToFcmTokens(tokens: string[], payload): Promise<{success,failed,invalidTokens}>`.
  - `src/lib/notification-icon.ts` → `resolveNotificationIcon({reason,tournamentLevel,followedPlayerAvatarUrl})` and `circuitIconUrl(level)`.
  - `src/lib/notification-categories.ts` → `shouldDeliverToRecipient`, `resolvePrefs`, `isProCategory`, `CATEGORY_META`.
  - `src/lib/entitlements.ts` → `isPro`.
- **`user_bookmarks`**: `(user_id, bookmark_type, target_id)`, `bookmark_type ∈ {match,player,tournament,news_source}`. Followers of tournament = `bookmark_type='tournament', target_id=<id>`.
- **`anon_bookmarks`**: only `{player,match}` (no tournament) → tournament events are authed-only. Fine for `tournament_starting`.
- **padelgod notify client** (`padelgod/src/lib/notify.ts`): `notifyLiveTransition(matchId, deps)` — `deps = { baseUrl, cronSecret, logger, fetchImpl? }`, POSTs `${baseUrl}/api/push/notify` with `Bearer cronSecret`, fire-and-forget, never throws. Scheduler wiring: `WorkerName` union + `ALL_WORKERS` + `getWorkerRunner` switch + `enableX` flag + `buildSchedule` entry, all in `padelgod/src/scheduler.ts`; flags populated in `padelgod/src/index.ts`; `NOTIFY_BASE_URL` + `CRON_SECRET` env already used.
- **`tournaments.starts_at`** is set by `tournament-discovery`. No worker currently watches it crossing `now()`.

---

## File Structure

**Create:**
- `supabase/migrations/20260608170000_event_notify_dedup.sql` — `tournaments.starting_notified_at` + generic `notification_events_sent` table.
- `src/lib/notify-recipients.ts` — `resolveEntityFollowers()` (+ types). Single responsibility: entity → recipient user IDs / anon devices.
- `src/lib/__tests__/notify-recipients.test.ts` — unit tests (pure query-builder shape + filtering logic via a fake supabase).
- `src/app/api/push/notify-event/route.ts` — the generic event fan-out endpoint.
- `padelgod/src/workers/tournament-start-notifier.ts` — detects `starts_at` edge, calls notify-event, sets marker.

**Modify:**
- `padelgod/src/lib/notify.ts` — add `notifyEvent(payload, deps)` client helper.
- `padelgod/src/scheduler.ts` — register the new worker (union, ALL_WORKERS, runner, flag, schedule entry).
- `padelgod/src/index.ts` — populate the `enableTournamentStartNotifier` flag from env.
- `src/lib/notification-categories.ts` — flip `tournament_starting.comingSoon` → `false`.
- `src/lib/__tests__/notification-categories.test.ts` — update the "live categories" expectation to include `tournament_starting`.

---

## Task 1: Dedup migration (marker column + sent-log)

**Files:** Create `supabase/migrations/20260608170000_event_notify_dedup.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260608170000_event_notify_dedup.sql
-- Idempotency for event-driven notifications (premium-notifications Plan 2).
-- Apply: node scripts/apply-migration.mjs supabase/migrations/20260608170000_event_notify_dedup.sql

-- Per-row marker for the single-owning-row event used in Plan 2A.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS starting_notified_at timestamptz NULL;

COMMENT ON COLUMN public.tournaments.starting_notified_at IS
  'Set when the tournament_starting notification has been fired. NULL = not yet sent.';

-- Generic sent-log for many-to-one events that lack a single owning row
-- (Plan 2B: draw_released per tournament+category, player_entered per tournament+player).
-- event_key convention: "<category>:<scope...>" e.g. "draw_released:<tid>:<category>".
CREATE TABLE IF NOT EXISTS public.notification_events_sent (
  event_key text PRIMARY KEY,
  category   text NOT NULL,
  fired_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_events_sent ENABLE ROW LEVEL SECURITY;
-- service-role only (workers); no anon/auth policies.
```

- [ ] **Step 2: Apply** — `node scripts/apply-migration.mjs supabase/migrations/20260608170000_event_notify_dedup.sql`
Expected: `Applied.` (no profiles-column arg needed here).

- [ ] **Step 3: Verify** (ad-hoc pg snippet — replace the SELECT):
```bash
node -e "import('pg').then(async ({Pool})=>{const fs=await import('node:fs');for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']$/g,'')}const u=new URL(process.env.DATABASE_URL);const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});console.log(JSON.stringify((await p.query(process.argv[1])).rows,null,2));await p.end()})" "SELECT column_name FROM information_schema.columns WHERE table_name='tournaments' AND column_name='starting_notified_at' UNION ALL SELECT table_name FROM information_schema.tables WHERE table_name='notification_events_sent'"
```
Expected: both `starting_notified_at` and `notification_events_sent` listed.

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260608170000_event_notify_dedup.sql
git commit -m "feat(db): event-notify dedup — tournaments.starting_notified_at + notification_events_sent"
```

---

## Task 2: Entity-follower resolver

**Files:** Create `src/lib/notify-recipients.ts` + `src/lib/__tests__/notify-recipients.test.ts`

This is the shared "followers of entity X" resolver the generic endpoint uses. Pure data-shaping over an injected supabase-like client so it's unit-testable.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/notify-recipients.test.ts
import { describe, it, expect } from 'vitest'
import { resolveEntityFollowers, type EntityType } from '@/lib/notify-recipients'

// Minimal fake of the supabase query-builder chain used by the resolver.
function fakeSupabase(rowsByTable: Record<string, unknown[]>) {
  const calls: { table: string; filters: Record<string, unknown> } = { table: '', filters: {} }
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {}
    const chain = {
      select() { return chain },
      eq(col: string, val: unknown) { filters[col] = val; return chain },
      in(col: string, val: unknown) { filters[col] = val; return chain },
      then(resolve: (r: { data: unknown[]; error: null }) => void) {
        calls.table = table; calls.filters = filters
        resolve({ data: rowsByTable[table] ?? [], error: null })
      },
    }
    return chain
  }
  return { from: builder, _calls: calls } as never
}

describe('resolveEntityFollowers', () => {
  it('queries user_bookmarks by bookmark_type+target_id for a tournament', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }, { user_id: 'u2' }] })
    const res = await resolveEntityFollowers(supa, 'tournament', 't-1')
    expect(res.userIds.sort()).toEqual(['u1', 'u2'])
    expect((supa as never as { _calls: { filters: Record<string, unknown> } })._calls.filters).toMatchObject({
      bookmark_type: 'tournament', target_id: 't-1',
    })
  })

  it('dedupes repeated user_ids', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }, { user_id: 'u1' }] })
    const res = await resolveEntityFollowers(supa, 'player', 'p-1')
    expect(res.userIds).toEqual(['u1'])
  })

  it('returns empty for no followers', async () => {
    const supa = fakeSupabase({})
    const res = await resolveEntityFollowers(supa, 'tournament', 't-x')
    expect(res.userIds).toEqual([])
  })

  it('rejects unsupported entity types at the type level (runtime guard returns empty)', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }] })
    // @ts-expect-error 'match' uses the dedicated match path, not this resolver
    const res = await resolveEntityFollowers(supa, 'news_source' as EntityType, 'x')
    expect(res.userIds).toEqual([])
  })
})
```

- [ ] **Step 2: Run → fails** (`npx vitest run src/lib/__tests__/notify-recipients.test.ts`) — module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/notify-recipients.ts
// Resolve "followers of entity X" for event-driven notifications.
// player/tournament events fan out to user_bookmarks rows of the matching type.
// (match-scoped events keep using the dedicated logic in /api/push/notify.)

import type { SupabaseClient } from '@supabase/supabase-js'

export type EntityType = 'player' | 'tournament'

export type EntityFollowers = {
  userIds: string[]
}

// Bookmark type per entity. Only player/tournament are supported here.
const BOOKMARK_TYPE: Record<EntityType, string> = {
  player: 'player',
  tournament: 'tournament',
}

export async function resolveEntityFollowers(
  supabase: Pick<SupabaseClient, 'from'>,
  entityType: EntityType,
  entityId: string,
): Promise<EntityFollowers> {
  const bookmarkType = BOOKMARK_TYPE[entityType]
  if (!bookmarkType) return { userIds: [] }

  const { data, error } = await supabase
    .from('user_bookmarks')
    .select('user_id')
    .eq('bookmark_type', bookmarkType)
    .eq('target_id', entityId)

  if (error || !data) return { userIds: [] }
  const userIds = Array.from(new Set((data as { user_id: string }[]).map((r) => r.user_id)))
  return { userIds }
}
```

> Anon followers: `anon_bookmarks` supports only `player`/`match`. Plan 2A's first sender is tournament-scoped (authed-only), so anon resolution is intentionally NOT in this helper yet. Plan 2B extends it with an `anonDevices` field for the player-scoped senders.

- [ ] **Step 4: Run → passes** (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/notify-recipients.ts src/lib/__tests__/notify-recipients.test.ts
git commit -m "feat(lib): resolveEntityFollowers — followers of a player/tournament"
```

---

## Task 3: Generic `/api/push/notify-event` endpoint

**Files:** Create `src/app/api/push/notify-event/route.ts`

Reuses the delivery helpers + tier gate. Resolves authed followers via Task 2, applies prefs/mute/dedup, fans out web + FCM + in-app. (Anon delivery deferred to Plan 2B for player-scoped events.)

- [ ] **Step 1: Implement the route**

```ts
// src/app/api/push/notify-event/route.ts
// Generic, entity-scoped notification fan-out. Internal (Bearer $CRON_SECRET).
//
// Body:
//   { category, entityType: 'player'|'tournament', entityId,
//     title, body, url?, metadata?, icon?, dedupeKey? }
//
// Resolves followers of the entity, applies the SAME tier gate + prefs + mute +
// in-app dedup as /api/push/notify, then delivers via sendPush + FCM + inbox.
import { createServiceClient } from '@/lib/supabase'
import { resolveEntityFollowers, type EntityType } from '@/lib/notify-recipients'
import { isProCategory, resolvePrefs, shouldDeliverToRecipient, isKnownCategory, type NotificationCategory } from '@/lib/notification-categories'
import { isPro } from '@/lib/entitlements'
import { sendPush } from '@/lib/push'
import { sendPushToFcmTokens } from '@/lib/push-fcm'

type Body = {
  category?: unknown
  entityType?: unknown
  entityId?: unknown
  title?: unknown
  body?: unknown
  url?: unknown
  metadata?: unknown
  icon?: unknown
  dedupeKey?: unknown
}

const ENTITY_TYPES = new Set<EntityType>(['player', 'tournament'])

export async function POST(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const b = (await request.json().catch(() => null)) as Body | null
  if (!b) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  if (!isKnownCategory(b.category)) return Response.json({ error: 'unknown category' }, { status: 400 })
  const category = b.category as NotificationCategory
  if (typeof b.entityType !== 'string' || !ENTITY_TYPES.has(b.entityType as EntityType)) {
    return Response.json({ error: 'bad entityType' }, { status: 400 })
  }
  const entityType = b.entityType as EntityType
  if (typeof b.entityId !== 'string' || !b.entityId) return Response.json({ error: 'bad entityId' }, { status: 400 })
  if (typeof b.title !== 'string' || typeof b.body !== 'string') return Response.json({ error: 'title/body required' }, { status: 400 })

  const title = b.title
  const body = b.body
  const url = typeof b.url === 'string' ? b.url : '/'
  const icon = typeof b.icon === 'string' ? b.icon : null
  const metadata = (b.metadata && typeof b.metadata === 'object') ? b.metadata as Record<string, unknown> : {}
  const dedupeKey = typeof b.dedupeKey === 'string' ? b.dedupeKey : `${category}:${entityType}:${b.entityId}`

  const supabase = createServiceClient()

  // 1. Recipients (authed followers of the entity)
  const { userIds } = await resolveEntityFollowers(supabase, entityType, b.entityId)
  if (userIds.length === 0) return Response.json({ ok: true, recipients: 0 })

  // 2. Prefs + plan + mute, batched
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, notification_prefs, notification_mute_until, plan, plan_expires_at')
    .in('id', userIds)
  const prefsByUser = new Map<string, Record<string, { push?: boolean }>>()
  const muteByUser = new Map<string, string | null>()
  const proByUser = new Map<string, boolean>()
  for (const row of profiles ?? []) {
    prefsByUser.set(row.id as string, (row.notification_prefs ?? {}) as Record<string, { push?: boolean }>)
    muteByUser.set(row.id as string, (row as { notification_mute_until?: string | null }).notification_mute_until ?? null)
    proByUser.set(row.id as string, isPro({ plan: (row as { plan?: 'free' | 'pro' }).plan ?? 'free', plan_expires_at: (row as { plan_expires_at?: string | null }).plan_expires_at ?? null }))
  }

  // 3. In-app dedup: skip users who already have this (category, dedupeKey) inbox row.
  const { data: already } = await supabase
    .from('user_notifications')
    .select('user_id')
    .eq('category', category)
    .eq('metadata->>dedupe_key', dedupeKey)
    .in('user_id', userIds)
  const alreadyById = new Set((already ?? []).map((r) => r.user_id as string))

  // 4. Per-recipient gate → build in-app rows + push targets
  const inAppRows: Record<string, unknown>[] = []
  const webTargets: string[] = []
  const now = Date.now()
  const deliver: string[] = []
  for (const userId of userIds) {
    if (alreadyById.has(userId)) continue
    if (!shouldDeliverToRecipient(category, proByUser.get(userId) ?? false)) continue // tier gate (push + inbox)
    inAppRows.push({
      user_id: userId, category, title, body, url,
      metadata: { ...metadata, dedupe_key: dedupeKey, entity_type: entityType, entity_id: b.entityId },
    })
    // push gating: per-category pref + mute
    const pref = resolvePrefs(prefsByUser.get(userId), category)
    const muteUntil = muteByUser.get(userId) ?? null
    const muted = muteUntil === 'forever' || (muteUntil != null && Date.parse(muteUntil) > now)
    if (pref.push && !muted) deliver.push(userId)
  }

  // 5. In-app inbox (always-on for delivered category)
  if (inAppRows.length) await supabase.from('user_notifications').insert(inAppRows)

  // 6. Web push
  let webSent = 0
  if (deliver.length) {
    const { data: subs } = await supabase.from('push_subscriptions').select('user_id, endpoint, keys').in('user_id', deliver)
    const payload = { title, body, url, icon: icon ?? undefined, data: { category, url } }
    const results = await Promise.allSettled((subs ?? []).map((s) =>
      sendPush({ endpoint: s.endpoint as string, keys: s.keys as { p256dh: string; auth: string } }, payload),
    ))
    webSent = results.filter((r) => r.status === 'fulfilled' && r.value).length
    void webTargets
  }

  // 7. FCM (native)
  let fcmSent = 0
  if (deliver.length) {
    const { data: nativeSubs } = await supabase.from('native_push_subscriptions').select('device_token').in('user_id', deliver)
    const tokens = (nativeSubs ?? []).map((r) => r.device_token as string).filter(Boolean)
    if (tokens.length) {
      const res = await sendPushToFcmTokens(tokens, { title, body, data: { category, url, ...(icon ? { icon } : {}) } })
      fcmSent = res.success
    }
  }

  return Response.json({ ok: true, recipients: userIds.length, inApp: inAppRows.length, webSent, fcmSent })
}
```

> IMPORTANT during implementation: verify the exact shapes of `sendPush` (subscription/payload) and `sendPushToFcmTokens` (payload) against `src/lib/push.ts` / `src/lib/push-fcm.ts` and the columns of `push_subscriptions` (`endpoint`, `keys`) and `native_push_subscriptions` (`device_token`) against the match route's usage — adapt field names to match. The match route at `src/app/api/push/notify/route.ts` is the reference for the exact payload/column shapes.

- [ ] **Step 2: Verify build + type** — run `npm install` first if needed, then `npx tsc --noEmit` and `npm run build`. Both clean.

- [ ] **Step 3: Manual end-to-end smoke** (proves the pipeline before any worker exists). With a tournament you follow (insert a `user_bookmarks` row for your user via the ad-hoc pg snippet if needed) and a local dev server:
```bash
curl -s -X POST http://localhost:3001/api/push/notify-event \
  -H "Authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
  -d '{"category":"tournament_starting","entityType":"tournament","entityId":"<TID-you-follow>","title":"Madrid P1 is underway","body":"Play has started — see today'\''s order of play."}'
```
Expected: `{"ok":true,"recipients":>=1,...}`; a row appears in `user_notifications` for your user; re-running with the same default dedupeKey does NOT create a second inbox row.

- [ ] **Step 4: Commit**
```bash
git add src/app/api/push/notify-event/route.ts
git commit -m "feat(api): generic /api/push/notify-event (entity-scoped fan-out, tier-gated)"
```

---

## Task 4: padelgod `notifyEvent()` client helper

**Files:** Modify `padelgod/src/lib/notify.ts`

- [ ] **Step 1: Add the helper** (mirror `notifyLiveTransition`'s deps/fire-and-forget/stats pattern). Read the existing file first to match `NotifyDeps`, logging, and `notify-stats` usage.

```ts
// Add to padelgod/src/lib/notify.ts

export type NotifyEventPayload = {
  category: string
  entityType: 'player' | 'tournament'
  entityId: string
  title: string
  body: string
  url?: string
  metadata?: Record<string, unknown>
  icon?: string
  dedupeKey?: string
}

/**
 * Fire an entity-scoped notification via the Next.js generic endpoint.
 * Fire-and-forget; never throws. No-op if baseUrl/cronSecret are missing.
 */
export function notifyEvent(payload: NotifyEventPayload, deps: NotifyDeps): void {
  const { baseUrl, cronSecret, logger, fetchImpl } = deps
  const doFetch = fetchImpl ?? fetch
  if (!baseUrl || !cronSecret) {
    logger?.warn?.('[notify] notifyEvent skipped — missing baseUrl/cronSecret')
    return
  }
  void (async () => {
    try {
      const res = await doFetch(`${baseUrl}/api/push/notify-event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cronSecret}` },
        body: JSON.stringify(payload),
      })
      if (!res.ok) logger?.warn?.(`[notify] notifyEvent ${payload.category} non-OK ${res.status}`)
    } catch (e) {
      logger?.warn?.(`[notify] notifyEvent ${payload.category} fetch error: ${(e as Error).message}`)
    }
  })()
}
```

> Match the actual `NotifyDeps` type and logger shape in the file. If `notify-stats` has counters, add minimal event counters or reuse existing ones — keep consistent with `notifyLiveTransition`.

- [ ] **Step 2: Build padelgod** — `cd padelgod && npm install` (if needed) then `npm run build` (or the package's typecheck script). Clean.

- [ ] **Step 3: Commit**
```bash
git add padelgod/src/lib/notify.ts
git commit -m "feat(padelgod): notifyEvent client for the generic notify-event endpoint"
```

---

## Task 5: `tournament-start-notifier` worker

**Files:** Create `padelgod/src/workers/tournament-start-notifier.ts`; modify `padelgod/src/scheduler.ts` + `padelgod/src/index.ts`

Detects tournaments whose `starts_at` has just passed and fires `tournament_starting` once each.

- [ ] **Step 1: Write the worker.** Read an existing simple worker (e.g. `fip-winner-propagator`) first to match the deps signature, supabase client access, logging, and return-shape conventions.

```ts
// padelgod/src/workers/tournament-start-notifier.ts
// Fire `tournament_starting` once per tournament when starts_at passes.
// Idempotent via tournaments.starting_notified_at (NULL-only UPDATE guard).
import { notifyEvent, type NotifyDeps } from '../lib/notify'
// import the project's supabase service client + worker deps types per existing workers

type Deps = NotifyDeps & {
  supabase: /* service client type used by other workers */ any
  logger?: { info?: (m: string) => void; warn?: (m: string) => void }
}

// Only notify tournaments that started within this window (avoid backfiring history
// the first time the column is NULL across the whole table).
const WINDOW_HOURS = 24

export async function runTournamentStartNotifier(deps: Deps): Promise<{ fired: number; skipped: number }> {
  const { supabase, logger } = deps
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString()
  const nowIso = new Date().toISOString()

  const { data: due, error } = await supabase
    .from('tournaments')
    .select('id, name, level, starts_at, starting_notified_at')
    .is('starting_notified_at', null)
    .lte('starts_at', nowIso)
    .gte('starts_at', sinceIso)
  if (error) { logger?.warn?.(`[tournament-start-notifier] query error: ${error.message}`); return { fired: 0, skipped: 0 } }

  let fired = 0, skipped = 0
  for (const t of due ?? []) {
    // Claim atomically: only proceed if WE set the marker (NULL → now).
    const { data: claimed } = await supabase
      .from('tournaments')
      .update({ starting_notified_at: nowIso })
      .eq('id', t.id)
      .is('starting_notified_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) { skipped++; continue }

    notifyEvent({
      category: 'tournament_starting',
      entityType: 'tournament',
      entityId: t.id as string,
      title: `${t.name} is underway`,
      body: 'Play has started — follow the action and order of play.',
      url: `/tournaments/${t.id}`,
      dedupeKey: `tournament_starting:${t.id}`,
    }, deps)
    fired++
  }
  logger?.info?.(`[tournament-start-notifier] fired=${fired} skipped=${skipped}`)
  return { fired, skipped }
}
```

> The atomic claim (`UPDATE ... WHERE starting_notified_at IS NULL ... RETURNING id`) is the idempotency guard — even if two ticks overlap, only one claims the row and fires. Use the project's actual supabase client + worker-deps types (read a sibling worker). Confirm `tournaments` has `name`/`level` columns (it does per schema).

- [ ] **Step 2: Register in `padelgod/src/scheduler.ts`** — add `'tournament-start-notifier'` to the `WorkerName` union and `ALL_WORKERS`; add a `getWorkerRunner` case returning `(deps) => runTournamentStartNotifier(deps)`; add `enableTournamentStartNotifier` to the flags type; add a `buildSchedule` entry gated by that flag (cron: hourly, e.g. `'0 * * * *'`, offset to avoid colliding with discovery at :00 — use `'20 * * * *'`).

- [ ] **Step 3: Populate the flag in `padelgod/src/index.ts`** — `enableTournamentStartNotifier: process.env.ENABLE_TOURNAMENT_START_NOTIFIER === 'true'` (default OFF so it ships dark, consistent with other new workers). Document the env var.

- [ ] **Step 4: Build padelgod** — `npm run build` in `padelgod/`. Clean.

- [ ] **Step 5: Manual worker smoke** (optional, local): temporarily set a followed tournament's `starts_at` to 1h ago + `starting_notified_at=NULL` via the pg snippet, run the worker once (invoke `runTournamentStartNotifier` through the package's worker-runner CLI if present, or a tiny scratch script), confirm `fired>=1`, the inbox row appears, and `starting_notified_at` is now set (re-run → `fired=0`).

- [ ] **Step 6: Commit**
```bash
git add padelgod/src/workers/tournament-start-notifier.ts padelgod/src/scheduler.ts padelgod/src/index.ts
git commit -m "feat(padelgod): tournament-start-notifier worker (fires tournament_starting once)"
```

---

## Task 6: Flip `tournament_starting` live

**Files:** Modify `src/lib/notification-categories.ts` + `src/lib/__tests__/notification-categories.test.ts`

- [ ] **Step 1: Set `comingSoon: false`** for `tournament_starting` in `CATEGORY_META` (it now has a real sender).

- [ ] **Step 2: Update the test** — the "only categories with real senders are live" test must now include `tournament_starting`:
```ts
expect(live.sort()).toEqual(['marketing', 'match_finished', 'match_live_bookmark', 'match_live_follow', 'tournament_starting'])
```

- [ ] **Step 3: Run** `npx vitest run src/lib/__tests__/notification-categories.test.ts` → passes.

- [ ] **Step 4: Commit**
```bash
git add src/lib/notification-categories.ts src/lib/__tests__/notification-categories.test.ts
git commit -m "feat(notifications): tournament_starting is live (drop Soon flag)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Unit tests** — `npx vitest run src/lib/__tests__/notify-recipients.test.ts src/lib/__tests__/notification-categories.test.ts src/lib/__tests__/entitlements.test.ts` → all pass.
- [ ] **Step 2: Build (Next.js)** — `npm run build` clean. **Build (padelgod)** — `cd padelgod && npm run build` clean.
- [ ] **Step 3: Lint touched files** — `npx eslint <the files this plan created/modified>` → exit 0.
- [ ] **Step 4: End-to-end** — the Task 3 curl produces a real inbox row + (with a push subscription) a web push; the Task 5 worker smoke fires once and is idempotent on re-run.
- [ ] **Step 5: Push branch + open PR** (do not merge until reviewed):
```bash
git push -u origin feat/premium-notifications-p2
gh pr create --base main --title "Premium Notifications — Plan 2A: event-notify pipeline + tournament_starting" --body "<summary + test plan>"
```

---

## Self-Review (coverage vs intent)

- **Generic pipeline** → Tasks 2 (resolver) + 3 (endpoint), reusing Plan 1's gate/prefs + existing delivery helpers. ✓
- **Dedup infra** → Task 1 (marker column + sent-log); endpoint in-app dedup via `metadata->>dedupe_key`; worker atomic-claim. ✓
- **padelgod client** → Task 4. ✓
- **First real sender (tournament_starting)** → Task 5 (new worker) + Task 6 (flip Soon). ✓
- **Tier gate honored** → endpoint calls `shouldDeliverToRecipient` (free category → always delivers; ready for Pro categories in Plan 3). ✓
- **Idempotency across recurring ticks** → atomic NULL-only claim on `starting_notified_at`. ✓
- **Anon followers** → intentionally deferred (tournament events are authed-only; `anon_bookmarks` lacks `tournament`). Player-scoped anon delivery lands in Plan 2B. Documented in Task 2. ✓
- **Out of scope (Plan 2B):** match_scheduled, player_title_won, player_eliminated, draw_released, player_entered; widening `anon_bookmarks`/anon delivery; unifying the match route onto the shared core.

## Open questions for the implementer
- Confirm `sendPush` subscription/payload shape + `push_subscriptions.keys` structure against the match route (adapt field names in Task 3 if they differ).
- Confirm padelgod's worker `Deps`/supabase-client convention from a sibling worker before finalizing Task 5's `Deps` type.
- Cron cadence for the notifier: hourly is fine (tournament starts aren't minute-critical); confirm no collision with `tournament-discovery` (:00) — plan uses `:20`.
