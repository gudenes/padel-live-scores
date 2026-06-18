# Morning Matchday Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a free, once-per-morning "your players today" digest — fired in each tournament's local morning via a Vercel cron — realizing `daily_oop` as the sender and retiring the mistimed `match_scheduled`.

**Architecture:** A new `/api/cron/matchday-digest` Vercel cron (hourly, `Bearer $CRON_SECRET`, gated by `ENABLE_MATCHDAY_DIGEST`, default off) scans today's matches per tournament-local timezone, groups them by recipient (player-followers + match-bookmarkers + anon devices), and sends **one digest push per (recipient, tournament)** via the existing transports — direct fan-out (the notify-event route is per-entity and doesn't fit a user-centric digest). Idempotency via `notification_events_sent`. Pure helpers (tz day-window, copy formatting, grouping) are unit-tested.

**Tech Stack:** Next.js 16 App Router (cron route), TypeScript, Supabase, Vitest. `Intl.DateTimeFormat` for tz math (no date-fns-tz in this app). Migrations N/A (reuses `notification_events_sent`).

**Spec:** `docs/superpowers/specs/2026-06-09-matchday-digest-design.md`

---

## Key recon facts
- Cron template: `src/app/api/cron/recompute-earnings/route.ts` — `GET`, `export const maxDuration`, `if (process.env.CRON_SECRET && authHeader !== 'Bearer '+CRON_SECRET) 401`, `createServerClient()` from `@/lib/supabase`, wrapped in `logOpsEvent('cron:...')`. `vercel.json` `crons` array entries `{ path, schedule }`.
- No main-app `getTournamentTimezone` — padelgod's (`fip-oop-writer.ts:689`) reads `tournaments.timezone` else `countryToTimezone(country)` (from `@/lib/country-timezone`, returns `string|null`). Mirror it main-side.
- No main-app tz day-window util — port the `Intl.DateTimeFormat` probe from `padelgod/src/lib/oop-schedule-parser.ts:77` (`localTimeToUtc`).
- Approximate time = `/not before/i.test(label) || /followed by/i.test(label)` on `matches.schedule_label` (no boolean column).
- Transports: `sendPush(sub:{endpoint,keys:{p256dh,auth}}, payload:PushPayload):Promise<boolean>` (`@/lib/push`); `sendPushToFcmTokens(tokens:string[], payload:FcmPayload):Promise<{success,failed,invalidTokens}>` (`@/lib/push-fcm`). `PushPayload`/`FcmPayload` = `{title,body,url?,tag?,icon?,sendId?}`. Columns: `push_subscriptions(id,endpoint,keys,user_id)`, `native_push_subscriptions(device_token,user_id)`, `anon_push_subscriptions(id,endpoint,p256dh_key,auth_key,last_seen_at)`.
- `resolvePrefs(stored, category):{push}` + `shouldDeliverToRecipient(category, isPro)` from `@/lib/notification-categories`. `paginatedSelect(buildQuery, {what})` from `@/lib/db-paginate`.
- No main-app `claimNotificationEvent` — mirror `padelgod/src/lib/notification-events.ts` (table `notification_events_sent(event_key PK, category, fired_at)`).
- `daily_oop` currently `{ tier:'pro', group:'predictions', comingSoon:true }`; `match_scheduled` `{ tier:'free', group:'matches', comingSoon:true }`.
- `match_scheduled` sender to remove: `padelgod/src/workers/fip-oop-writer.ts:429-474`.
- Tests to fix: `src/lib/__tests__/notification-categories.test.ts:185` (live-senders `live.sort()` expectation) + `:195` (the `isProCategory('daily_oop')).toBe(true)` assertion → move to the free test).

---

## File Structure
**Create (main):** `src/lib/tournament-day-window.ts` (+test), `src/lib/matchday-digest.ts` (pure copy/grouping helpers, +test), `src/lib/notification-events.ts` (claim mirror), `src/app/api/cron/matchday-digest/route.ts`.
**Modify (main):** `src/lib/notification-categories.ts` (daily_oop free; remove match_scheduled), `src/lib/notification-catalog.ts` (`CATEGORY_RULES` daily_oop rule; drop match_scheduled), `src/lib/__tests__/notification-categories.test.ts` + `notification-catalog.test.ts` (fix expectations), `src/messages/{en,es,pt,it,fr}.json` (relabel daily_oop; drop match_scheduled), `vercel.json` (cron entry).
**Modify (padelgod):** `padelgod/src/workers/fip-oop-writer.ts` (remove match_scheduled sender + dead `scheduled_notified_at` usage).

---

## Task 1: Category surface — `daily_oop` free + retire `match_scheduled` (main)

**Files:** `src/lib/notification-categories.ts`, `src/lib/notification-catalog.ts`, `src/lib/__tests__/notification-categories.test.ts`, `src/lib/__tests__/notification-catalog.test.ts`, `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Update tests first (red).** In `notification-categories.test.ts`:
  - **Do NOT change the live-senders expectation** (line ~185). `daily_oop` keeps `comingSoon: true` (ships dark behind `ENABLE_MATCHDAY_DIGEST`), so it is NOT yet "live" — the `live.sort()` list stays `['marketing', 'match_finished', 'match_live_bookmark', 'match_live_follow']`.
  - In the `new pro categories are pro` test (~:192-197), **remove** the `expect(isProCategory('daily_oop')).toBe(true)` line (it's free now).
  - In the `new free categories are free` test (~:198-202), **add** `expect(isProCategory('daily_oop')).toBe(false)`.
  - Anywhere the tests reference `'match_scheduled'` (e.g. a category-count or the catalog test), drop it. In `notification-catalog.test.ts` the coverage test iterates `KNOWN_CATEGORIES`, so it auto-adjusts — but if any test hard-lists `match_scheduled`, remove it.
  Run `npx vitest run src/lib/__tests__/notification-categories.test.ts` → FAIL (expected, on the pro/free assertions).

- [ ] **Step 2: `notification-categories.ts`** — (a) remove `match_scheduled` from the `NotificationCategory` union; (b) remove its `CATEGORY_META` row (line ~66); (c) flip ONLY `daily_oop`'s tier to free — **keep `comingSoon: true`** (ships dark; the Soon pill drops at go-live when the env flag flips):
  ```ts
  daily_oop:            { defaults: { push: true }, tier: 'free', group: 'predictions',  comingSoon: true },
  ```

- [ ] **Step 3: `notification-catalog.ts`** — remove the `match_scheduled` `CATEGORY_RULES` entry; rewrite `daily_oop`'s rule + sample:
  ```ts
  daily_oop:            { rule: "Each tournament's local morning (~08:00): a digest of your followed players' / bookmarked matches that day. → those followers. Free. Gated by ENABLE_MATCHDAY_DIGEST (Vercel cron /api/cron/matchday-digest).", sampleTitle: 'Madrid P1 — your players today', sampleBody: 'Tapia ~18:00 · Galán 19:30 · Sánchez/Josemaría 16:00' },
  ```

- [ ] **Step 4: i18n** — in all 5 `src/messages/*.json`, remove the `notifications.settings.category.match_scheduled` entry, and update `daily_oop`'s label/sub:
  ```json
  "daily_oop": { "label": "Matchday digest", "sub": "A morning summary of your players' matches today" }
  ```
  (Apply to en + the 4 locales — English copy acceptable for es/pt/it/fr, matching the existing placeholder convention.)

- [ ] **Step 5: Run** `npx vitest run src/lib/__tests__/notification-categories.test.ts src/lib/__tests__/notification-catalog.test.ts` → PASS. Then `npx tsc --noEmit` (catches any lingering `'match_scheduled'` reference in main-app code; there should be none after this — the only sender is padelgod, removed in Task 2). Then `npm run build`.

- [ ] **Step 6: Commit**
```bash
git add src/lib/notification-categories.ts src/lib/notification-catalog.ts src/lib/__tests__/notification-categories.test.ts src/lib/__tests__/notification-catalog.test.ts src/messages/*.json
git commit -m "feat(notifications): daily_oop becomes the free matchday digest; retire match_scheduled category"
```
(Co-Authored-By trailer.)

---

## Task 2: Remove the `match_scheduled` sender (padelgod)

**Files:** `padelgod/src/workers/fip-oop-writer.ts`

- [ ] **Step 1: Read** `fip-oop-writer.ts` around lines 429-474 (the `match_scheduled` block) + line 138 (`scheduled_notified_at` on the row interface) + line 661 (the select).

- [ ] **Step 2: Remove the sender block** (the whole `const firstFirmFill = …; if (deps.eventsEnabled && deps.notify && firstFirmFill && p.approximate === false) { …notifyEvent({category:'match_scheduled',…})… }`, ~429-474).

- [ ] **Step 3: Clean up dead refs** — `grep -n "scheduled_notified_at\|notifyEvent\|eventsEnabled\|deps.notify\|isPlaceholderScheduledAt" padelgod/src/workers/fip-oop-writer.ts`:
  - If `scheduled_notified_at` is now unused, remove it from the row interface (line ~138) and the select string (line ~661).
  - If `notifyEvent` import (line 10) has no other use in the file, remove the import (keep `NotifyDeps` if still referenced).
  - If `deps.eventsEnabled`/`deps.notify` have no other consumer in this worker, leave the deps fields (they're shared on `SchedulerDeps`; only remove the file-local interface fields if they exist AND are now unused — don't touch the shared scheduler wiring).
  - If `isPlaceholderScheduledAt` is now unused, remove it; if still used by the scheduled_at write logic, keep it.
  (The DB column `matches.scheduled_notified_at` stays — harmless.)

- [ ] **Step 4: Verify** `cd padelgod && npm run typecheck` → clean. Run the fip-oop-writer test file (`npx vitest run src/__tests__/workers/fip-oop-writer.test.ts`) → pass (remove/adjust any test asserting match_scheduled fired).

- [ ] **Step 5: Commit**
```bash
git add padelgod/src/workers/fip-oop-writer.ts
git commit -m "feat(padelgod): remove match_scheduled sender (superseded by the matchday digest)"
```
(Co-Authored-By trailer.)

---

## Task 3: Pure helpers — tz day-window + digest formatting + grouping (main)

**Files:** Create `src/lib/tournament-day-window.ts`, `src/lib/matchday-digest.ts` + tests `src/lib/__tests__/tournament-day-window.test.ts`, `src/lib/__tests__/matchday-digest.test.ts`

- [ ] **Step 1: Failing tests** — `tournament-day-window.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { localHourIn, zonedDayBoundsUtc } from '@/lib/tournament-day-window'

describe('localHourIn', () => {
  it('returns the wall-clock hour in the tz', () => {
    // 2026-06-09T06:30:00Z = 08:30 in Madrid (CEST, +2)
    expect(localHourIn('Europe/Madrid', new Date('2026-06-09T06:30:00Z'))).toBe(8)
    // same instant = 03:30 in Buenos Aires (-3)
    expect(localHourIn('America/Argentina/Buenos_Aires', new Date('2026-06-09T06:30:00Z'))).toBe(3)
  })
})

describe('zonedDayBoundsUtc', () => {
  it('returns the UTC instants bracketing the tz-local calendar day + the local date', () => {
    const r = zonedDayBoundsUtc('Europe/Madrid', new Date('2026-06-09T06:30:00Z'))
    expect(r.localDate).toBe('2026-06-09')
    // Madrid 2026-06-09 00:00 CEST = 2026-06-08T22:00Z ; next day 00:00 = 2026-06-09T22:00Z
    expect(r.startUtc).toBe('2026-06-08T22:00:00.000Z')
    expect(r.endUtc).toBe('2026-06-09T22:00:00.000Z')
  })
})
```
`matchday-digest.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isApproximateLabel, formatDigestBody, groupRecipients, type DigestMatch } from '@/lib/matchday-digest'

describe('isApproximateLabel', () => {
  it('flags Not before / Followed by as approximate', () => {
    expect(isApproximateLabel('Not before 18:00')).toBe(true)
    expect(isApproximateLabel('Followed by')).toBe(true)
    expect(isApproximateLabel('Starting at 18:00')).toBe(false)
    expect(isApproximateLabel(null)).toBe(false)
  })
})

describe('formatDigestBody', () => {
  it('lists entries, marks approximate, caps at 4 with +N more', () => {
    const items = [
      { label: 'Tapia', time: '16:00', approximate: false },
      { label: 'Galán', time: '17:30', approximate: true },
      { label: 'Coello', time: '18:00', approximate: false },
      { label: 'Lebrón', time: '19:00', approximate: false },
      { label: 'Stupa', time: '20:00', approximate: false },
    ]
    expect(formatDigestBody(items)).toBe('Tapia 16:00 · Galán 17:30* · Coello 18:00 · Lebrón 19:00 · +1 more')
  })
})

describe('groupRecipients', () => {
  it('maps each user to the matches they follow (player) or bookmarked', () => {
    const matches: DigestMatch[] = [
      { matchId: 'm1', players: ['p1', 'p2'] },
      { matchId: 'm2', players: ['p3', 'p4'] },
    ]
    const playerFollows = [{ user_id: 'u1', target_id: 'p1' }, { user_id: 'u2', target_id: 'p3' }]
    const matchBookmarks = [{ user_id: 'u1', target_id: 'm2' }]
    const g = groupRecipients(matches, playerFollows, matchBookmarks)
    expect(g.get('u1')!.sort()).toEqual(['m1', 'm2']) // follows p1 (m1) + bookmarked m2
    expect(g.get('u2')).toEqual(['m2'])               // follows p3 (m2)
  })
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `src/lib/tournament-day-window.ts`** (Intl probe; mirrors `oop-schedule-parser.ts:77`):
```ts
// src/lib/tournament-day-window.ts
// Tournament-local-timezone day math for the matchday digest. Uses Intl
// (no date-fns-tz in this app). All inputs/outputs are UTC except the tz arg.

export function localHourIn(tz: string, now: Date): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now)
  return parseInt(h, 10) % 24
}

// The local Y-M-D in tz at `now`, and the UTC instants of local 00:00 today and 00:00 tomorrow.
export function zonedDayBoundsUtc(tz: string, now: Date): { localDate: string; startUtc: string; endUtc: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  const localDate = `${get('year')}-${get('month')}-${get('day')}`
  const start = zonedMidnightToUtc(tz, localDate)
  const end = new Date(start.getTime() + 24 * 3600_000)
  // 24h add can drift across DST; re-derive end from the next calendar date to be exact:
  const next = new Date(start.getTime() + 36 * 3600_000) // safely into next day
  const np = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(next)
  const ng = (t: string) => np.find((p) => p.type === t)!.value
  const endExact = zonedMidnightToUtc(tz, `${ng('year')}-${ng('month')}-${ng('day')}`)
  void end
  return { localDate, startUtc: start.toISOString(), endUtc: endExact.toISOString() }
}

// UTC instant of local 00:00 on `dateStr` (YYYY-MM-DD) in tz. Probe-and-correct for DST.
function zonedMidnightToUtc(tz: string, dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  const asLocal = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess)
  const gp = (t: string) => parseInt(asLocal.find((p) => p.type === t)!.value, 10)
  // What wall-clock the UTC guess shows in tz; offset = guess-shown-local minus desired-midnight.
  const shown = Date.UTC(gp('year'), gp('month') - 1, gp('day'), gp('hour') === 24 ? 0 : gp('hour'), gp('minute'))
  const desired = Date.UTC(y, m - 1, d, 0, 0)
  return new Date(guess.getTime() + (desired - shown))
}
```

- [ ] **Step 4: Implement `src/lib/matchday-digest.ts`**:
```ts
// src/lib/matchday-digest.ts
// Pure helpers for the matchday digest: approximate-label detection, body
// formatting, and recipient grouping. No I/O.

export function isApproximateLabel(label: string | null | undefined): boolean {
  if (!label) return false
  return /not before/i.test(label) || /followed by/i.test(label)
}

export type DigestItem = { label: string; time: string; approximate: boolean }

export function formatDigestBody(items: DigestItem[], cap = 4): string {
  const shown = items.slice(0, cap).map((i) => `${i.label} ${i.time}${i.approximate ? '*' : ''}`)
  const extra = items.length - cap
  if (extra > 0) shown.push(`+${extra} more`)
  return shown.join(' · ')
}

export type DigestMatch = { matchId: string; players: (string | null)[] }
type Bookmark = { user_id: string; target_id: string }

// user_id → set of matchIds relevant to them (follows a player in the match, or bookmarked it).
export function groupRecipients(
  matches: DigestMatch[],
  playerFollows: Bookmark[],
  matchBookmarks: Bookmark[],
): Map<string, string[]> {
  const matchesByPlayer = new Map<string, string[]>()
  for (const m of matches) for (const p of m.players) {
    if (!p) continue
    const arr = matchesByPlayer.get(p) ?? []
    arr.push(m.matchId)
    matchesByPlayer.set(p, arr)
  }
  const out = new Map<string, Set<string>>()
  const add = (u: string, mid: string) => { const s = out.get(u) ?? new Set(); s.add(mid); out.set(u, s) }
  for (const f of playerFollows) for (const mid of matchesByPlayer.get(f.target_id) ?? []) add(f.user_id, mid)
  const matchIds = new Set(matches.map((m) => m.matchId))
  for (const b of matchBookmarks) if (matchIds.has(b.target_id)) add(b.user_id, b.target_id)
  return new Map([...out].map(([u, s]) => [u, [...s].sort()]))
}
```

- [ ] **Step 5: Run → pass** (both test files). `npx tsc --noEmit` clean. `npx eslint` the new files.

- [ ] **Step 6: Commit**
```bash
git add src/lib/tournament-day-window.ts src/lib/matchday-digest.ts src/lib/__tests__/tournament-day-window.test.ts src/lib/__tests__/matchday-digest.test.ts
git commit -m "feat(lib): matchday digest pure helpers (tz day-window, formatting, grouping)"
```
(Co-Authored-By trailer.)

---

## Task 4: Main-app `getTournamentTimezone` + `claimNotificationEvent`

**Files:** Create `src/lib/notification-events.ts`; add `getTournamentTimezone` (in `src/lib/tournament-day-window.ts` or a small `src/lib/tournament-timezone.ts`).

- [ ] **Step 1: `src/lib/notification-events.ts`** (mirror padelgod's):
```ts
// src/lib/notification-events.ts
// Main-app "fire this event once" claim against public.notification_events_sent.
import type { SupabaseClient } from '@supabase/supabase-js'

export async function claimNotificationEvent(
  supabase: Pick<SupabaseClient, 'from'>,
  eventKey: string,
  category: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_events_sent')
    .upsert({ event_key: eventKey, category }, { onConflict: 'event_key', ignoreDuplicates: true })
    .select('event_key')
  if (error) return false
  return Array.isArray(data) && data.length > 0
}
```

- [ ] **Step 2: `getTournamentTimezone`** (add to `src/lib/tournament-day-window.ts`; mirror `fip-oop-writer.ts:689`):
```ts
import { countryToTimezone } from '@/lib/country-timezone'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function getTournamentTimezone(
  supabase: Pick<SupabaseClient, 'from'>,
  tournamentId: string,
): Promise<string | null> {
  const { data } = await supabase.from('tournaments').select('timezone, country').eq('id', tournamentId).maybeSingle()
  const explicit = (data?.timezone as string | null) ?? null
  if (explicit) return explicit
  return countryToTimezone((data?.country as string | null) ?? null)
}
```

- [ ] **Step 3:** `npx tsc --noEmit` clean. (A tiny unit test for `claimNotificationEvent` with a fake supabase is optional; the padelgod parity is the reference.)

- [ ] **Step 4: Commit**
```bash
git add src/lib/notification-events.ts src/lib/tournament-day-window.ts
git commit -m "feat(lib): main-app claimNotificationEvent + getTournamentTimezone"
```
(Co-Authored-By trailer.)

---

## Task 5: The matchday-digest cron route

**Files:** Create `src/app/api/cron/matchday-digest/route.ts`; Modify `vercel.json`

- [ ] **Step 1: Implement the route** (GET, Bearer + ENABLE_MATCHDAY_DIGEST gate, the batch sender). Use the recompute-earnings auth/structure. Algorithm:
  1. Candidate matches: `scheduled_at` in a broad UTC window `[now-12h, now+30h]` (covers any tz's "today"), select `id, scheduled_at, schedule_label, tournament_id, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id` + the player display names (join or a follow-up lookup). Use `paginatedSelect`.
  2. Group candidate matches by `tournament_id`. For each tournament: `getTournamentTimezone`; skip (log) if null. Compute `localHourIn(tz, now)` and `zonedDayBoundsUtc(tz, now)`. Proceed only if `localHour >= 8`. Filter that tournament's matches to those with `scheduled_at` in `[startUtc, endUtc)` → "today's matches".
  3. Recipients: query `user_bookmarks` for `bookmark_type='player' AND target_id IN (today's matches' player ids)` and `bookmark_type='match' AND target_id IN (today's match ids)`; `groupRecipients(...)` → `Map<userId, matchIds[]>`. Same for `anon_bookmarks` → `Map<deviceId, matchIds[]>`.
  4. Batch-fetch `profiles` (notification_prefs, notification_mute_until, plan, plan_expires_at) for the user ids.
  5. Per authed recipient: `claimNotificationEvent(supabase, 'daily_oop:'+tournamentId+':'+localDate+':'+userId, 'daily_oop')`; if not claimed, skip. Gate `resolvePrefs(prefs,'daily_oop').push && !muted && shouldDeliverToRecipient('daily_oop', isPro(...))`. Build body: for each of the recipient's matchIds, `{ label: <player or pair name>, time: <scheduled_at formatted in tz>, approximate: isApproximateLabel(schedule_label) }`, sort by time, `formatDigestBody`. Title `'<tournament name> — your players today'`. Send via `sendPush` (their `push_subscriptions`) + `sendPushToFcmTokens` (their `native_push_subscriptions`). Stale cleanup as in notify-event.
  6. Per anon device: claim `daily_oop:<tid>:<localDate>:anon:<deviceId>`; send via `sendPush` over `anon_push_subscriptions`.
  7. Log one `notification_sends` row per tournament (`kind:'category'`, `metadata.category='daily_oop'`, channel counts) for console telemetry.
  8. Return `{ ok, tournamentsConsidered, tournamentsSent, recipients, sent }`.

  Time formatting in tz: `new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(scheduled_at))`. Player/pair label: prefer the followed player's name; for a match digest line use the followed player's last name (resolve names via a `players` lookup keyed by the 4 ids). Keep labels short.

  Reuse the transport + stale-cleanup shapes from `src/app/api/push/notify-event/route.ts` (the per-recipient `sendPush`/`sendPushToFcmTokens` + stale delete/`last_seen_at` bump). Add `export const maxDuration = 120`.

  > This route is large; keep the pure bits (Task 3 helpers) doing the formatting/grouping/tz math, and keep this route to: query → group → gate → compose (via helpers) → send → log.

- [ ] **Step 2: `vercel.json`** — add to `crons`:
```json
{ "path": "/api/cron/matchday-digest", "schedule": "0 * * * *" }
```

- [ ] **Step 3: Verify** `npx tsc --noEmit` clean; `npm run build` (route present `/api/cron/matchday-digest`); `npx eslint` the route.

- [ ] **Step 4: Commit**
```bash
git add src/app/api/cron/matchday-digest/route.ts vercel.json
git commit -m "feat(cron): matchday-digest — morning per-tournament 'your players today' digest (dark behind ENABLE_MATCHDAY_DIGEST)"
```
(Co-Authored-By trailer.)

---

## Task 6: Verify + PR

- [ ] **Step 1: Tests** — `npx vitest run src/lib/__tests__/tournament-day-window.test.ts src/lib/__tests__/matchday-digest.test.ts src/lib/__tests__/notification-catalog.test.ts src/lib/__tests__/notification-categories.test.ts` → pass.
- [ ] **Step 2: Builds** — main `npm run build`; `cd padelgod && npm run typecheck` → clean.
- [ ] **Step 3: Lint** touched files.
- [ ] **Step 4: e2e (controller)** — with `ENABLE_MATCHDAY_DIGEST=true` locally + a followed player in a tournament that has matches today and whose local hour ≥ 8 (or temporarily stub `now`): hit `/api/cron/matchday-digest` with `Bearer $CRON_SECRET` → it sends a digest to the operator-followed recipient + logs a `notification_sends` row + claims the dedup key; re-run → no re-send. Also confirm a tournament with no resolvable tz is skipped. Clean up test rows.
- [ ] **Step 5: Push + PR** (don't merge until reviewed):
```bash
git push -u origin feat/matchday-digest
gh pr create --base main --title "Morning matchday digest (free daily_oop), retire match_scheduled" --body "<summary + test plan + go-live note>"
```

---

## Self-Review (coverage vs spec)
- **daily_oop → free morning digest + retire match_scheduled** → Task 1 (catalog/i18n/tests) + Task 2 (padelgod sender removal). ✓
- **Surfaces in sync** (settings auto from CATEGORY_META; console from CATEGORY_RULES; relabel daily_oop; drop match_scheduled i18n) → Task 1. ✓
- **Tournament-local morning trigger** → Task 3 (`localHourIn`/`zonedDayBoundsUtc`) + Task 4 (`getTournamentTimezone`) + Task 5 (cron gate). ✓
- **Recipients + per-(recipient,tournament) digest + cap + approximate marker** → Task 3 (`groupRecipients`/`formatDigestBody`/`isApproximateLabel`) + Task 5. ✓
- **Idempotency per recipient+tournament+day** → Task 4 (`claimNotificationEvent`) + Task 5 key. ✓
- **New user-centric sender, reuse transports/prefs/telemetry, paginate** → Task 5. ✓
- **Ship dark (ENABLE_MATCHDAY_DIGEST)** → Task 5 gates the cron (default off); Task 1 flips `daily_oop` tier→free but keeps `comingSoon: true` (Soon pill stays; live-senders test unchanged). Go-live step (later): set the env true + drop the Soon pill (flip `comingSoon:false` + add `daily_oop` to the live-senders test). Consistent with the rest of the rollout. ✓

## Open questions for the implementer
- Player/pair **name resolution** for the digest line: confirm `players.name`/`last_name` columns and the cheapest lookup for the 4 ids per match (one `players` `.in(id)` fetch for all today's player ids, mapped). Use last name for brevity.
- "Broad candidate window" `[now-12h, now+30h]` is a heuristic to capture any tz's "today" — confirm it comfortably covers all tournament tzs (UTC-12..+14); widen to `[now-18h, now+30h]` if needed.
- Cron cadence `0 * * * *` (hourly) means a tournament fires within the hour after its local 08:00 — fine for a morning digest. Per-recipient claim makes re-runs safe.
