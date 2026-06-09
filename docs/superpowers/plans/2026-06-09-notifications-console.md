# Notifications Console (Ops) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an operator Notifications console (`admin.padelnachos.com/system/notifications`) — a per-category catalog with activity-derived Live/Soon/Idle status + operational health, plus an ad-hoc trigger (Test-to-me default + guarded Send-to-followers) — reusing the broadcast feature's analytics substrate.

**Architecture:** Main app owns data/actions + the `CATEGORY_META` catalog; `apps/ops` is a thin UI that forwards through `/api/internal/*` (operator-auth → `CRON_SECRET`), mirroring the broadcast feature. The keystone is making `/api/push/notify-event` log a `notification_sends` row (`kind:'category'`) so every category send becomes visible. Console reads a new main-app catalog+health endpoint; triggers reuse `test-push` (test-to-me) and `notify-event` (real, dry-run-then-confirm).

**Tech Stack:** Next.js 16 App Router (main + `apps/ops`), TypeScript, Supabase (pg, service key), Vitest. Migrations via `node scripts/apply-migration.mjs`. Two separate npm packages (root + `apps/ops`); run `npm install` in each before building.

**Spec:** `docs/superpowers/specs/2026-06-09-notifications-console-design.md`

**Conventions:** commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `apps/ops` cannot import main-app `src/` (separate tsconfig `@/*`→`apps/ops/src/*`); cross-app data flows through internal proxies + `CRON_SECRET`. `notification_sends` is service-role-only (no RLS policies).

---

## Key recon facts (from the codebase, verified)
- `notification_sends` columns: `id, created_at, kind CHECK('broadcast','match'), title, body, url, label, metadata jsonb, dry_run, web_fired/web_accepted/web_stale, fcm_fired/fcm_accepted/fcm_failed/fcm_stale, anon_fired/anon_accepted/anon_stale, recipients_total, accepted_total, clicks` (`supabase/migrations/20260603_notification_analytics.sql:7-34`). Constraint is unnamed → `notification_sends_kind_check`.
- Match route logs a row one-shot after fan-out in try/catch (`src/app/api/push/notify/route.ts:733-764`) — mirror this.
- `notify-event` route (`src/app/api/push/notify-event/route.ts`, 318 lines): auth Bearer CRON_SECRET (`:54`); body parse + validation (`:53-89`); resolver + early return (`:91-101`); per-user loop (`:141-180`); in-app insert (`:182-193`); authed fan-out in `if (deliver.length > 0)` block (`:195-259`, where `staleIds`/`subs`/`tokens` are block-scoped); anon fan-out (`:261-302`); response (`:310-317`). Counters at end: `webSent`, `fcmSent`, `anonSent`, `inApp`.
- Ops proxy pattern: `apps/ops/src/app/api/internal/broadcast/route.ts` (operator `session.user.isOperator` → fetch `${MAIN_APP_URL ?? 'https://padelnachos.com'}/api/admin/...` with `Bearer CRON_SECRET`). `broadcast-test` forwards `{email,title,body,url}` to `/api/admin/test-push` using `session.user.email`.
- Ops reads DB via `createServiceClient()` (`apps/ops/src/lib/supabase.ts`); `listRecentSends` in `apps/ops/src/lib/broadcast-queries.ts`. UI primitives from `@/components/ui` (`PageHeader, Panel, Button, DataTable, EmptyState, KpiStrip, Kpi, Pill`); inputs use bare classes `ui-input`/`ui-field`. Page body wraps `<div className="ui-page">`.
- Nav: `apps/ops/src/components/shell/Rail.tsx` System group (`:43-55`) has `{ href:'/system/broadcast', label:'Broadcast', icon:'bell' }`. Item type at `:8`.
- Feature flags: DB table `feature_flags (key PK, enabled, enabled_local, label, description, ...)`, public-read RLS; ops route `apps/ops/src/app/api/internal/feature-flags/route.ts`.
- `CATEGORY_META` + `KNOWN_CATEGORIES`/`isProCategory` in `src/lib/notification-categories.ts:49-117`. Catalog cannot be imported by ops → catalog endpoint lives in main app.

---

## File Structure

**Create (main app):**
- `supabase/migrations/20260609120000_notification_sends_category_kind.sql` — extend `kind` CHECK with `'category'`.
- `src/lib/notification-catalog.ts` — pure helpers: `deriveCategoryStatus()`, `buildCatalog()` (join CATEGORY_META + send aggregates).
- `src/lib/__tests__/notification-catalog.test.ts` — unit tests.
- `src/app/api/internal/notification-catalog/route.ts` — GET catalog+health (Bearer CRON_SECRET).

**Modify (main app):**
- `src/app/api/push/notify-event/route.ts` — hoist channel counters; add `notification_sends` insert (kind `'category'`); add `dryRun` mode.

**Create (ops app):**
- `apps/ops/src/app/api/internal/notification-catalog/route.ts` — proxy (GET).
- `apps/ops/src/app/api/internal/notify-test/route.ts` — proxy → main `test-push`.
- `apps/ops/src/app/api/internal/notify-trigger/route.ts` — proxy → main `notify-event` (dry-run + real).
- `apps/ops/src/lib/notification-catalog-types.ts` — shared TS types for the catalog payload.
- `apps/ops/src/app/(app)/system/notifications/page.tsx` — server component.
- `apps/ops/src/app/(app)/system/notifications/_components/NotificationsConsole.tsx` — client view.
- `apps/ops/src/app/(app)/system/notifications/_components/console.module.css` — styles.

**Modify (ops app):**
- `apps/ops/src/components/shell/Rail.tsx` — add the Notifications nav item (flag-gated).

---

## Task 1: Migration — extend `notification_sends.kind` with `'category'`

**Files:** Create `supabase/migrations/20260609120000_notification_sends_category_kind.sql`

- [ ] **Step 1: Write**
```sql
-- supabase/migrations/20260609120000_notification_sends_category_kind.sql
-- Allow per-category event sends to be logged in notification_sends (Notifications console).
ALTER TABLE public.notification_sends DROP CONSTRAINT IF EXISTS notification_sends_kind_check;
ALTER TABLE public.notification_sends
  ADD CONSTRAINT notification_sends_kind_check CHECK (kind IN ('broadcast', 'match', 'category'));
```
- [ ] **Step 2: Apply** — `node scripts/apply-migration.mjs supabase/migrations/20260609120000_notification_sends_category_kind.sql` → `Applied.`
- [ ] **Step 3: Verify** the constraint allows 'category' (ad-hoc pg snippet):
```bash
node -e "import('pg').then(async ({Pool})=>{const fs=await import('node:fs');for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']$/g,'')}const u=new URL(process.env.DATABASE_URL);const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});console.log(JSON.stringify((await p.query(process.argv[1])).rows,null,2));await p.end()})" "SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='notification_sends_kind_check'"
```
Expected: `CHECK (kind = ANY (ARRAY['broadcast','match','category']))`.
- [ ] **Step 4: Commit** — `feat(db): allow notification_sends.kind='category'`

---

## Task 2: `notify-event` — log a `kind:'category'` row + `dryRun` mode

**Files:** Modify `src/app/api/push/notify-event/route.ts`

Two changes to the existing route. Read it first; line numbers are approximate.

- [ ] **Step 1: Hoist the channel counters** so they're available for the analytics row. The route currently declares `webSent`/`fcmSent` and has `staleIds`/`subs`/`tokens` block-scoped inside `if (deliver.length > 0)`. Add function-scoped accumulators near the existing `let webSent = 0` / `let fcmSent = 0` / `let anonSent = 0`:
```ts
let webFired = 0, webStale = 0
let fcmFired = 0, fcmFailed = 0, fcmStale = 0
let anonFired = 0, anonStale = 0
```
Inside the authed block, set `webFired = subs.length`, `webStale = staleIds.length`, `fcmFired = tokens.length`, `fcmFailed = res.failed`, `fcmStale = res.invalidTokens.length` (adapt to the actual variable names — `res` is the `sendPushToFcmTokens` result with `{success, failed, invalidTokens}`). In the anon block set `anonFired = anonSubs.length`, `anonStale = <anon stale ids>.length`. (These mirror the values already computed; you're just lifting them to outer scope.)

- [ ] **Step 2: Add the `dryRun` mode.** Parse `dryRun` from the body (`const dryRun = b.dryRun === true`). After the per-user resolution loop computes `deliver` + `inAppRows` (but BEFORE the in-app insert + fan-out), if `dryRun`, return reach counts without sending or writing anything:
```ts
if (dryRun) {
  // reach = users who would receive a push (post dedup + tier gate + pref + mute) + anon subs
  return Response.json({
    ok: true, dryRun: true,
    recipients: deliver.length,
    inAppWould: inAppRows.length,
    anonWould: anonSubs.length,
  })
}
```

- [ ] **Step 3: Add the analytics insert** after the anon fan-out + the existing `console.log`, BEFORE the final `Response.json` (`~:304`). Mirror the match route's one-shot try/catch:
```ts
try {
  await supabase.from('notification_sends').insert({
    kind: 'category',
    title,
    body,
    url,
    metadata: { category, entity_type: entityType, entity_id: b.entityId, dedupe_key: dedupeKey, inapp_written: inApp },
    web_fired: webFired, web_accepted: webSent, web_stale: webStale,
    fcm_fired: fcmFired, fcm_accepted: fcmSent, fcm_failed: fcmFailed, fcm_stale: fcmStale,
    anon_fired: anonFired, anon_accepted: anonSent, anon_stale: anonStale,
    recipients_total: webFired + fcmFired + anonFired,
    accepted_total: webSent + fcmSent + anonSent,
  })
} catch (e) {
  console.error('[notify-event] notification_sends insert failed:', (e as Error).message)
}
```
(Only on the real path — the `dryRun` early-return above skips it. There is no test-to-me path in this route; test-to-me reuses `test-push`.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm run build` compiles; `npx eslint src/app/api/push/notify-event/route.ts` exit 0.
- [ ] **Step 5: Commit** — `feat(notify): log category sends to notification_sends + dryRun reach mode`

---

## Task 3: Catalog + status helpers (pure, unit-tested)

**Files:** Create `src/lib/notification-catalog.ts` + `src/lib/__tests__/notification-catalog.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/lib/__tests__/notification-catalog.test.ts
import { describe, it, expect } from 'vitest'
import { deriveCategoryStatus, buildCatalog, type SendAgg } from '@/lib/notification-catalog'

const NOW = Date.parse('2026-06-09T12:00:00Z')
const recent = '2026-06-08T12:00:00Z'   // 1 day ago
const old = '2026-05-01T00:00:00Z'      // >30 days ago

describe('deriveCategoryStatus', () => {
  it('live when fired within 7d', () => {
    expect(deriveCategoryStatus({ comingSoon: false, lastFiredAt: recent }, NOW)).toBe('live')
  })
  it('idle when has sender but no recent fire', () => {
    expect(deriveCategoryStatus({ comingSoon: false, lastFiredAt: old }, NOW)).toBe('idle')
    expect(deriveCategoryStatus({ comingSoon: false, lastFiredAt: null }, NOW)).toBe('idle')
  })
  it('soon when comingSoon and never fired', () => {
    expect(deriveCategoryStatus({ comingSoon: true, lastFiredAt: null }, NOW)).toBe('soon')
  })
  it('live overrides comingSoon if it actually fired recently', () => {
    expect(deriveCategoryStatus({ comingSoon: true, lastFiredAt: recent }, NOW)).toBe('live')
  })
})

describe('buildCatalog', () => {
  it('joins every known category with its aggregate + status', () => {
    const aggs: SendAgg[] = [{ category: 'match_finished', lastFiredAt: recent, count7d: 5, recipients7d: 50, failed7d: 1 }]
    const rows = buildCatalog(aggs, NOW)
    const finished = rows.find(r => r.key === 'match_finished')!
    expect(finished.status).toBe('live')
    expect(finished.count7d).toBe(5)
    const dark = rows.find(r => r.key === 'match_deciding_set')!  // comingSoon, no agg
    expect(dark.status).toBe('soon')
    expect(dark.count7d).toBe(0)
    expect(rows.length).toBeGreaterThan(20) // all known categories present
  })
})
```

- [ ] **Step 2: Run → fail** (`npx vitest run src/lib/__tests__/notification-catalog.test.ts`).

- [ ] **Step 3: Implement**
```ts
// src/lib/notification-catalog.ts
// Pure shaping for the ops Notifications console: join CATEGORY_META with
// notification_sends aggregates and derive a live/idle/soon status.
import { CATEGORY_META, KNOWN_CATEGORIES, type NotificationCategory } from '@/lib/notification-categories'

export type CategoryStatus = 'live' | 'idle' | 'soon'

const LIVE_WINDOW_MS = 7 * 24 * 3600_000

export function deriveCategoryStatus(
  input: { comingSoon: boolean; lastFiredAt: string | null },
  now: number,
): CategoryStatus {
  if (input.lastFiredAt && now - Date.parse(input.lastFiredAt) <= LIVE_WINDOW_MS) return 'live'
  if (input.comingSoon) return 'soon'
  return 'idle'
}

export type SendAgg = {
  category: string
  lastFiredAt: string | null
  count7d: number
  recipients7d: number
  failed7d: number
}

export type CatalogRow = {
  key: NotificationCategory
  tier: 'free' | 'pro'
  group: string
  comingSoon: boolean
  status: CategoryStatus
  lastFiredAt: string | null
  count7d: number
  recipients7d: number
  failed7d: number
}

export function buildCatalog(aggs: SendAgg[], now: number): CatalogRow[] {
  const byCat = new Map(aggs.map((a) => [a.category, a]))
  return KNOWN_CATEGORIES.map((key) => {
    const meta = CATEGORY_META[key]
    const agg = byCat.get(key)
    return {
      key,
      tier: meta.tier,
      group: meta.group,
      comingSoon: meta.comingSoon,
      status: deriveCategoryStatus({ comingSoon: meta.comingSoon, lastFiredAt: agg?.lastFiredAt ?? null }, now),
      lastFiredAt: agg?.lastFiredAt ?? null,
      count7d: agg?.count7d ?? 0,
      recipients7d: agg?.recipients7d ?? 0,
      failed7d: agg?.failed7d ?? 0,
    }
  })
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `feat(lib): notification catalog + status helpers`

---

## Task 4: Main-app catalog+health endpoint

**Files:** Create `src/app/api/internal/notification-catalog/route.ts`

- [ ] **Step 1: Implement** (Bearer CRON_SECRET; aggregate recent `kind:'category'` sends per `metadata->>category`, then `buildCatalog`):
```ts
// src/app/api/internal/notification-catalog/route.ts
// GET → { categories: CatalogRow[] }. Internal (Bearer $CRON_SECRET).
import { createServiceClient } from '@/lib/supabase'
import { buildCatalog, type SendAgg } from '@/lib/notification-catalog'

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const sinceIso = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
  // Pull recent category sends; aggregate in JS (volume is low — one row per send).
  const { data, error } = await supabase
    .from('notification_sends')
    .select('created_at, metadata, recipients_total, fcm_failed')
    .eq('kind', 'category')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const aggByCat = new Map<string, SendAgg>()
  for (const row of data ?? []) {
    const cat = (row.metadata as { category?: string } | null)?.category
    if (!cat) continue
    const a = aggByCat.get(cat) ?? { category: cat, lastFiredAt: null, count7d: 0, recipients7d: 0, failed7d: 0 }
    a.count7d += 1
    a.recipients7d += (row.recipients_total as number) ?? 0
    a.failed7d += (row.fcm_failed as number) ?? 0
    const ts = row.created_at as string
    if (!a.lastFiredAt || ts > a.lastFiredAt) a.lastFiredAt = ts
    aggByCat.set(cat, a)
  }
  const categories = buildCatalog([...aggByCat.values()], Date.now())
  return Response.json({ categories })
}
```
> Note: 7d window keeps it bounded; if a category last fired >7d ago it shows `lastFiredAt: null` here → status `idle`/`soon`, which is the intended signal. (A longer "last ever fired" lookup is a future nicety; YAGNI for v1.)

- [ ] **Step 2: Verify** build + tsc + eslint clean.
- [ ] **Step 3: Commit** — `feat(api): internal notification-catalog endpoint`

---

## Task 5: Ops proxies (catalog, test, trigger)

**Files:** Create `apps/ops/src/app/api/internal/notification-catalog/route.ts`, `.../notify-test/route.ts`, `.../notify-trigger/route.ts`

All three clone the broadcast proxy auth+forward shape (`apps/ops/src/app/api/internal/broadcast/route.ts`).

- [ ] **Step 1: Catalog proxy (GET)**
```ts
// apps/ops/src/app/api/internal/notification-catalog/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
export const dynamic = 'force-dynamic'
export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  try {
    const r = await fetch(`${target}/api/internal/notification-catalog`, { headers: { Authorization: `Bearer ${secret}` } })
    const json = await r.json().catch(() => ({}))
    return NextResponse.json(json, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: 'forward_failed', message: (e as Error).message }, { status: 502 })
  }
}
```

- [ ] **Step 2: Test-to-me proxy (POST)** — clone `broadcast-test/route.ts` verbatim but at the new path (it already forwards `{email,title,body,url}` → main `/api/admin/test-push` using `session.user.email`). This is the Test-to-me path; no main-app change needed.
```ts
// apps/ops/src/app/api/internal/notify-test/route.ts  (clone of broadcast-test)
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const email = session.user.email
  if (!email) return NextResponse.json({ error: 'no_email_on_session' }, { status: 400 })
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  const { title, body, url } = (await req.json().catch(() => ({}))) as { title?: string; body?: string; url?: string }
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  const r = await fetch(`${target}/api/admin/test-push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, title, body, url }),
  })
  const json = await r.json().catch(() => ({}))
  return NextResponse.json({ ...json, email }, { status: r.status })
}
```

- [ ] **Step 3: Trigger proxy (POST)** — forwards the full body (incl. `dryRun`) to main `/api/push/notify-event`:
```ts
// apps/ops/src/app/api/internal/notify-trigger/route.ts  (clone of broadcast proxy, different target)
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  const body = await req.json().catch(() => ({}))
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  try {
    const r = await fetch(`${target}/api/push/notify-event`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await r.json().catch(() => ({}))
    return NextResponse.json(json, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: 'forward_failed', message: (e as Error).message }, { status: 502 })
  }
}
```

- [ ] **Step 4: Verify** — `cd apps/ops && npx tsc --noEmit` clean (ops typecheck).
- [ ] **Step 5: Commit** — `feat(ops): internal proxies for notification catalog + test + trigger`

---

## Task 6: Feature flag

**Files:** none new (DB row + gate logic in Task 7's page/nav)

- [ ] **Step 1: Add the flag row** (ad-hoc pg snippet — `feature_flags` is service-role write):
```bash
node -e "import('pg').then(async ({Pool})=>{const fs=await import('node:fs');for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']$/g,'')}const u=new URL(process.env.DATABASE_URL);const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});await p.query(\"INSERT INTO public.feature_flags (key, enabled, label, description) VALUES ('notifications_console', false, 'Notifications console', 'Ops per-category notification catalog + trigger') ON CONFLICT (key) DO NOTHING\");console.log('flag inserted');await p.end()})"
```
Default **off** (ships dark). Verify the row exists.
- [ ] **Step 2:** No commit (DB row only). Gating logic lands in Task 7.

> The ops app reads `feature_flags` via its service client. Task 7 reads the `notifications_console` flag server-side and (a) returns a 404/empty state if off, (b) hides the rail item if off.

---

## Task 7: Ops console page + view + nav

**Files:** Create `apps/ops/src/lib/notification-catalog-types.ts`, `apps/ops/src/app/(app)/system/notifications/page.tsx`, `.../_components/NotificationsConsole.tsx`, `.../_components/console.module.css`; Modify `apps/ops/src/components/shell/Rail.tsx`

- [ ] **Step 1: Shared types**
```ts
// apps/ops/src/lib/notification-catalog-types.ts
export type CategoryStatus = 'live' | 'idle' | 'soon'
export type CatalogRow = {
  key: string; tier: 'free' | 'pro'; group: string; comingSoon: boolean
  status: CategoryStatus; lastFiredAt: string | null
  count7d: number; recipients7d: number; failed7d: number
}
```

- [ ] **Step 2: Page (server component)** — gate on the flag, fetch the catalog via the proxy, render the view. Use a small flag read (mirror how `feature-flags` route reads the table via `createServiceClient`):
```tsx
// apps/ops/src/app/(app)/system/notifications/page.tsx
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import NotificationsConsole from './_components/NotificationsConsole'
import type { CatalogRow } from '@/lib/notification-catalog-types'

export const metadata = { title: 'Notifications · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

async function flagOn(): Promise<boolean> {
  const s = createServiceClient()
  const { data } = await s.from('feature_flags').select('enabled, enabled_local').eq('key', 'notifications_console').maybeSingle()
  return Boolean(data?.enabled || (data as { enabled_local?: boolean } | null)?.enabled_local)
}

export default async function NotificationsPage() {
  if (!(await flagOn())) notFound()
  // Server-side fetch of the catalog through the main app (operator context not needed here — use CRON_SECRET directly server-side).
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  let categories: CatalogRow[] = []
  try {
    const r = await fetch(`${target}/api/internal/notification-catalog`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, cache: 'no-store' })
    if (r.ok) categories = (await r.json()).categories ?? []
  } catch { /* render with empty catalog on failure */ }
  return <NotificationsConsole initialCategories={categories} />
}
```

- [ ] **Step 3: Client view** — catalog table (grouped, status pills, health columns) + trigger panel (category select + title/body/url; Test-to-me button → `/api/internal/notify-test`; Send-to-followers with entity type+id, Dry-run → reach → type-`SEND` → Send, → `/api/internal/notify-trigger` with `{category, entityType, entityId, title, body, url, dryRun}`). Reuse the broadcast confirm state-machine pattern (`reach` + `confirmText === 'SEND'` arm gate). Import primitives `{ PageHeader, Panel, Button, DataTable, EmptyState, Pill } from '@/components/ui'`. (Write the full component following `BroadcastView.tsx` conventions: `'use client'`, `useState`, `useRouter`, `ui-page` wrapper, `ui-input`/`ui-field` inputs.)

- [ ] **Step 4: Rail item** — in `apps/ops/src/components/shell/Rail.tsx`, add to the System group items array (after the Broadcast entry): `{ href: '/system/notifications', label: 'Notifications', icon: 'bell' }`. Gate its visibility on the `notifications_console` flag if the Rail already does flag-aware filtering; otherwise the page's `notFound()` is the guard and the link can show (or wire a flag check consistent with how the Rail handles other conditional items — check the file). Keep it simple: if the Rail has no flag plumbing, leave the item visible (page 404s when off) and note it.

- [ ] **Step 5: Verify** — `cd apps/ops && npx tsc --noEmit` + `npm run build` clean; eslint the new files.
- [ ] **Step 6: Commit** — `feat(ops): notifications console page (catalog + trigger), flag-gated`

---

## Task 8: Final verification + PR

- [ ] **Step 1: Tests** — `npx vitest run src/lib/__tests__/notification-catalog.test.ts` (+ the existing notification suites) → pass.
- [ ] **Step 2: Builds** — main `npm run build`; `cd apps/ops && npm run build` → both clean. tsc clean both.
- [ ] **Step 3: Lint** touched files (both apps) → clean.
- [ ] **Step 4: e2e (controller)** — with the flag flipped on locally: (a) GET the main `/api/internal/notification-catalog` with CRON_SECRET → returns all categories with status; (b) fire `notify-event` (real) for a followed entity → a `kind:'category'` row appears + the category shows `live` in the catalog; (c) `notify-event` with `dryRun:true` → returns reach counts, no row, no send; (d) Test-to-me proxy → operator receives a push, no `notification_sends` row. Clean up test rows + flip flag off.
- [ ] **Step 5: Push + PR** (don't merge until reviewed):
```bash
git push -u origin feat/notifications-console
gh pr create --base main --title "Notifications console (ops): catalog + health + trigger" --body "<summary + test plan>"
```

---

## Self-Review (coverage vs spec)
- **Telemetry keystone** (`notify-event`→`notification_sends` kind=category) → Task 1 (migration) + Task 2. ✓
- **Catalog + derived status** → Task 3 (helpers + tests) + Task 4 (endpoint). ✓
- **Test-to-me** (reuse test-push) → Task 5 Step 2. ✓ *(simpler than the spec's `testRecipientUserId` — reuses the existing email→test-push path; documented.)*
- **Send-to-followers** (dry-run + confirm) → Task 2 (dryRun mode) + Task 5 Step 3 (proxy) + Task 7 Step 3 (UI confirm). ✓
- **Catalog+health read + status** → Task 4 + Task 7. ✓
- **Sibling page + rail + flag** → Task 6 (flag) + Task 7. ✓
- **Reuse broadcast substrate, no new analytics table** → confirmed (reuses `notification_sends`, proxy pattern, ui primitives, confirm UX). ✓
- **Operational-health-only (no engagement)** → catalog shows fired/recipients/failed; no click/open rates. ✓

## Open questions for the implementer
- "Failures" metric: the plan surfaces `fcm_failed` as `failed7d`. `*_stale` are expired-sub cleanups, not failures — leave them out of the failed count (or show separately if cheap).
- Rail flag-gating: confirm whether `Rail.tsx` already filters items by a flag; if not, the page `notFound()` is the guard (Task 7 Step 4).
- Entity picker (Send-to-followers): v1 can accept a pasted UUID + a type select; reuse the ops `/api/internal/search` command-palette lookup for player/tournament as a polish follow-up if time permits.
