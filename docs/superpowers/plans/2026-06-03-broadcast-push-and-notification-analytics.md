# Broadcast Push + Notification Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an operator broadcast-push capability (send one notification to the entire installed base) plus durable per-send analytics that both the broadcast and the existing match notifications write into.

**Architecture:** The main app (padelnachos.com) owns all sending — it has the VAPID/FCM secrets and the `sendPush`/`sendPushToFcmTokens` helpers. A new `src/lib/broadcast-push.ts` core (dependency-injected, unit-tested) fans out across the three subscription tables and reports per-channel counts. A new `POST /api/admin/broadcast-push` route wires it to Supabase and records a `notification_sends` row. The existing `/api/push/notify` route gains one additive `notification_sends` insert. Web click-through is tracked via a `data.send_id` carried in the payload, beaconed back from `public/sw.js` to `POST /api/push/click`. The admin UI lives on admin.padelnachos.com (`apps/ops`) and forwards to the main app via the established `trigger-translation-backfill` proxy pattern; it reads analytics straight from shared Supabase.

**Tech Stack:** Next.js 16 (App Router) main app + `apps/ops` admin app, Supabase (PostgREST + SQL migrations), `web-push`, `firebase-admin`, Vitest (node env).

---

## File Structure

**Main app (padelnachos.com):**
- Create: `supabase/migrations/20260603_notification_analytics.sql` — the two analytics tables.
- Create: `src/lib/broadcast-push.ts` — pure-ish fan-out core (`runBroadcast`, `resultToCountsRow`, types). DI'd, unit-tested.
- Create: `src/lib/__tests__/broadcast-push.test.ts` — unit tests for the core.
- Create: `src/app/api/admin/broadcast-push/route.ts` — `CRON_SECRET` endpoint, wires Supabase + the core.
- Create: `src/app/api/push/click/route.ts` — click beacon target.
- Modify: `src/lib/push.ts` — add optional `sendId` to `PushPayload`.
- Modify: `src/lib/push-fcm.ts` — add optional `sendId` to `FcmPayload` data.
- Modify: `src/app/api/push/notify/route.ts` — one additive `notification_sends` insert (`kind='match'`).
- Modify: `public/sw.js` — carry `sendId` into notification data; beacon on click.

**Admin app (admin.padelnachos.com — `apps/ops`):**
- Create: `apps/ops/src/app/api/internal/broadcast/route.ts` — operator-auth → forwards to main app.
- Create: `apps/ops/src/lib/broadcast-queries.ts` — read `notification_sends` history.
- Create: `apps/ops/src/app/(app)/system/broadcast/page.tsx` — route entry.
- Create: `apps/ops/src/app/(app)/system/broadcast/_components/BroadcastView.tsx` — compose + dry-run + send + history UI.
- Modify: `apps/ops/src/components/shell/Rail.tsx` — add the nav item.

---

## Task 1: Analytics tables migration

**Files:**
- Create: `supabase/migrations/20260603_notification_analytics.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260603_notification_analytics.sql
-- Durable per-send analytics for push notifications. One notification_sends
-- row per send EVENT (a broadcast, or one /api/push/notify match fan-out).
-- notification_clicks records web click-through, attributed via send_id that
-- rides in the push payload's data block. Service-key access only.

CREATE TABLE IF NOT EXISTS public.notification_sends (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind             TEXT NOT NULL CHECK (kind IN ('broadcast', 'match')),
  title            TEXT NOT NULL,
  body             TEXT,
  url              TEXT,
  label            TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  dry_run          BOOLEAN NOT NULL DEFAULT false,

  web_fired        INT NOT NULL DEFAULT 0,
  web_accepted     INT NOT NULL DEFAULT 0,
  web_stale        INT NOT NULL DEFAULT 0,

  fcm_fired        INT NOT NULL DEFAULT 0,
  fcm_accepted     INT NOT NULL DEFAULT 0,
  fcm_failed       INT NOT NULL DEFAULT 0,
  fcm_stale        INT NOT NULL DEFAULT 0,

  anon_fired       INT NOT NULL DEFAULT 0,
  anon_accepted    INT NOT NULL DEFAULT 0,
  anon_stale       INT NOT NULL DEFAULT 0,

  recipients_total INT NOT NULL DEFAULT 0,
  accepted_total   INT NOT NULL DEFAULT 0,
  clicks           INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS notification_sends_created_idx
  ON public.notification_sends (created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_clicks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id     UUID NOT NULL REFERENCES public.notification_sends(id) ON DELETE CASCADE,
  clicked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform    TEXT
);

CREATE INDEX IF NOT EXISTS notification_clicks_send_idx
  ON public.notification_clicks (send_id);

ALTER TABLE public.notification_sends  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_clicks ENABLE ROW LEVEL SECURITY;
-- No policies: service role bypasses RLS; anon/auth roles get no access.

-- Atomic click increment used by POST /api/push/click.
CREATE OR REPLACE FUNCTION public.increment_notification_clicks(p_send_id UUID)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.notification_sends SET clicks = clicks + 1 WHERE id = p_send_id;
$$;
```

- [ ] **Step 2: Apply the migration to the linked Supabase project**

Run: `npx supabase db push`
Expected: output lists `20260603_notification_analytics.sql` as applied with no error. (If the project uses a different apply flow, run that — confirm both tables exist afterward.)

- [ ] **Step 3: Verify the tables and function exist**

Run:
```bash
npx supabase db diff --schema public 2>&1 | grep -i notification_sends || echo "no pending diff (already applied)"
```
Expected: `no pending diff (already applied)` (the table is now part of the schema).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603_notification_analytics.sql
git commit -m "feat(db): notification_sends + notification_clicks analytics tables"
```

---

## Task 2: Broadcast fan-out core (`src/lib/broadcast-push.ts`)

A dependency-injected core so it unit-tests with fakes — no network, no DB. Also extend the payload types so a `sendId` can ride along for click attribution.

**Files:**
- Modify: `src/lib/push.ts` (add `sendId` to `PushPayload`)
- Modify: `src/lib/push-fcm.ts` (add `sendId` to `FcmPayload`)
- Create: `src/lib/broadcast-push.ts`
- Test: `src/lib/__tests__/broadcast-push.test.ts`

- [ ] **Step 1: Add `sendId` to `PushPayload`**

In `src/lib/push.ts`, extend the interface (add the field after `icon?`):

```ts
export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  icon?: string
  /** Analytics correlation id (notification_sends.id). When present it is
   *  serialized into the pushed JSON so public/sw.js can echo it into the
   *  notification's data block and beacon it back on click. */
  sendId?: string
}
```

No other change to `push.ts` — `sendNotification` already stringifies the whole payload, so `sendId` is included automatically.

- [ ] **Step 2: Add `sendId` to `FcmPayload` and forward it into the data block**

In `src/lib/push-fcm.ts`, extend the interface:

```ts
export interface FcmPayload {
  title: string
  body: string
  url?: string
  tag?: string
  icon?: string
  /** Analytics correlation id — see PushPayload.sendId. */
  sendId?: string
}
```

Then in `sendPushToFcmTokens`, inside the `data: { ... }` object of `sendEachForMulticast`, add the field alongside `icon`:

```ts
    data: {
      title: payload.title,
      body: payload.body,
      url: payload.url || '/',
      tag: payload.tag || 'match-live',
      ...(payload.icon ? { icon: payload.icon } : {}),
      ...(payload.sendId ? { sendId: payload.sendId } : {}),
    },
```

- [ ] **Step 3: Write the failing test**

```ts
// src/lib/__tests__/broadcast-push.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runBroadcast, resultToCountsRow, type BroadcastDeps } from '../broadcast-push'

function deps(over: Partial<BroadcastDeps> = {}): BroadcastDeps {
  return {
    fetchWebSubs: vi.fn(async () => [
      { id: 'w1', endpoint: 'e1', keys: { p256dh: 'a', auth: 'b' } },
      { id: 'w2', endpoint: 'e2', keys: { p256dh: 'a', auth: 'b' } },
    ]),
    fetchFcmTokens: vi.fn(async () => ['t1', 't2', 't3']),
    fetchAnonSubs: vi.fn(async () => [
      { id: 'a1', endpoint: 'ae1', keys: { p256dh: 'a', auth: 'b' } },
    ]),
    sendWeb: vi.fn(async () => true),
    sendFcm: vi.fn(async (tokens: string[]) => ({ success: tokens.length, failed: 0, invalidTokens: [] })),
    cleanupWebStale: vi.fn(async () => {}),
    cleanupFcmStale: vi.fn(async () => {}),
    cleanupAnonStale: vi.fn(async () => {}),
    ...over,
  }
}

describe('runBroadcast', () => {
  it('sends across all channels and aggregates accepted counts', async () => {
    const d = deps()
    const r = await runBroadcast({ title: 'Hi', body: 'Help us!', sendId: 's1' }, d)

    expect(r.web).toEqual({ fired: 2, accepted: 2, stale: 0 })
    expect(r.fcm).toEqual({ fired: 3, accepted: 3, failed: 0, stale: 0 })
    expect(r.anon).toEqual({ fired: 1, accepted: 1, stale: 0 })
    expect(r.recipients_total).toBe(6)
    expect(r.accepted_total).toBe(6)
    expect(r.dry_run).toBe(false)
    expect(d.sendWeb).toHaveBeenCalledTimes(2)
    expect(d.cleanupWebStale).not.toHaveBeenCalled()
  })

  it('counts stale web subs and cleans them up', async () => {
    const sendWeb = vi.fn(async (sub: { endpoint: string }) => sub.endpoint !== 'e2')
    const cleanupWebStale = vi.fn(async () => {})
    const r = await runBroadcast({ title: 'x', body: 'y' }, deps({ sendWeb, cleanupWebStale }))
    expect(r.web).toEqual({ fired: 2, accepted: 1, stale: 1 })
    expect(cleanupWebStale).toHaveBeenCalledWith(['w2'])
  })

  it('maps fcm failures and invalid tokens', async () => {
    const sendFcm = vi.fn(async () => ({ success: 1, failed: 1, invalidTokens: ['t3'] }))
    const cleanupFcmStale = vi.fn(async () => {})
    const r = await runBroadcast({ title: 'x', body: 'y' }, deps({ sendFcm, cleanupFcmStale }))
    expect(r.fcm).toEqual({ fired: 3, accepted: 1, failed: 1, stale: 1 })
    expect(cleanupFcmStale).toHaveBeenCalledWith(['t3'])
  })

  it('dry run counts reach but sends nothing', async () => {
    const d = deps()
    const r = await runBroadcast({ title: 'x', body: 'y', dryRun: true }, d)
    expect(r.dry_run).toBe(true)
    expect(r.recipients_total).toBe(6)
    expect(r.accepted_total).toBe(0)
    expect(r.web.fired).toBe(2)
    expect(d.sendWeb).not.toHaveBeenCalled()
    expect(d.sendFcm).not.toHaveBeenCalled()
    expect(d.cleanupWebStale).not.toHaveBeenCalled()
  })

  it('resultToCountsRow flattens to DB columns', () => {
    const row = resultToCountsRow({
      web: { fired: 2, accepted: 2, stale: 0 },
      fcm: { fired: 3, accepted: 3, failed: 0, stale: 0 },
      anon: { fired: 1, accepted: 1, stale: 0 },
      recipients_total: 6, accepted_total: 6, dry_run: false,
    })
    expect(row).toEqual({
      web_fired: 2, web_accepted: 2, web_stale: 0,
      fcm_fired: 3, fcm_accepted: 3, fcm_failed: 0, fcm_stale: 0,
      anon_fired: 1, anon_accepted: 1, anon_stale: 0,
      recipients_total: 6, accepted_total: 6,
    })
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/broadcast-push.test.ts`
Expected: FAIL — `Cannot find module '../broadcast-push'`.

- [ ] **Step 5: Implement `src/lib/broadcast-push.ts`**

```ts
// src/lib/broadcast-push.ts
// Dependency-injected broadcast fan-out. The route supplies real Supabase-
// backed deps; tests supply fakes. Knows nothing about HTTP or the DB.

import type { PushPayload } from './push'
import type { FcmSendResult } from './push-fcm'

export interface WebSub {
  id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface BroadcastInput {
  title: string
  body: string
  url?: string
  label?: string
  icon?: string
  /** notification_sends.id, embedded in each payload for click attribution. */
  sendId?: string
  dryRun?: boolean
}

export interface BroadcastDeps {
  fetchWebSubs: () => Promise<WebSub[]>
  fetchFcmTokens: () => Promise<string[]>
  fetchAnonSubs: () => Promise<WebSub[]>
  sendWeb: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload) => Promise<boolean>
  sendFcm: (tokens: string[], payload: PushPayload) => Promise<FcmSendResult>
  cleanupWebStale: (ids: string[]) => Promise<void>
  cleanupFcmStale: (tokens: string[]) => Promise<void>
  cleanupAnonStale: (ids: string[]) => Promise<void>
}

export interface WebChannelCounts { fired: number; accepted: number; stale: number }
export interface FcmChannelCounts { fired: number; accepted: number; failed: number; stale: number }

export interface BroadcastResult {
  web: WebChannelCounts
  fcm: FcmChannelCounts
  anon: WebChannelCounts
  recipients_total: number
  accepted_total: number
  dry_run: boolean
}

const CONCURRENCY = 100

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function sendWebChannel(
  subs: WebSub[],
  payload: PushPayload,
  send: BroadcastDeps['sendWeb'],
  cleanup: (ids: string[]) => Promise<void>,
): Promise<WebChannelCounts> {
  const staleIds: string[] = []
  let accepted = 0
  for (const batch of chunk(subs, CONCURRENCY)) {
    const results = await Promise.all(
      batch.map((s) =>
        send({ endpoint: s.endpoint, keys: s.keys }, payload).then((ok) => ({ ok, id: s.id })),
      ),
    )
    for (const r of results) {
      if (r.ok) accepted++
      else staleIds.push(r.id)
    }
  }
  if (staleIds.length) await cleanup(staleIds)
  return { fired: subs.length, accepted, stale: staleIds.length }
}

export async function runBroadcast(input: BroadcastInput, deps: BroadcastDeps): Promise<BroadcastResult> {
  const payload: PushPayload = {
    title: input.title,
    body: input.body,
    url: input.url || '/',
    tag: 'broadcast',
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.sendId ? { sendId: input.sendId } : {}),
  }

  const [webSubs, fcmTokens, anonSubs] = await Promise.all([
    deps.fetchWebSubs(),
    deps.fetchFcmTokens(),
    deps.fetchAnonSubs(),
  ])

  if (input.dryRun) {
    return {
      web: { fired: webSubs.length, accepted: 0, stale: 0 },
      fcm: { fired: fcmTokens.length, accepted: 0, failed: 0, stale: 0 },
      anon: { fired: anonSubs.length, accepted: 0, stale: 0 },
      recipients_total: webSubs.length + fcmTokens.length + anonSubs.length,
      accepted_total: 0,
      dry_run: true,
    }
  }

  const web = await sendWebChannel(webSubs, payload, deps.sendWeb, deps.cleanupWebStale)
  const anon = await sendWebChannel(anonSubs, payload, deps.sendWeb, deps.cleanupAnonStale)

  let fcm: FcmChannelCounts = { fired: fcmTokens.length, accepted: 0, failed: 0, stale: 0 }
  if (fcmTokens.length) {
    const res = await deps.sendFcm(fcmTokens, payload)
    fcm = { fired: fcmTokens.length, accepted: res.success, failed: res.failed, stale: res.invalidTokens.length }
    if (res.invalidTokens.length) await deps.cleanupFcmStale(res.invalidTokens)
  }

  const recipients_total = web.fired + fcm.fired + anon.fired
  const accepted_total = web.accepted + fcm.accepted + anon.accepted
  return { web, fcm, anon, recipients_total, accepted_total, dry_run: false }
}

/** Flatten a BroadcastResult into the notification_sends count columns. */
export function resultToCountsRow(r: BroadcastResult) {
  return {
    web_fired: r.web.fired,
    web_accepted: r.web.accepted,
    web_stale: r.web.stale,
    fcm_fired: r.fcm.fired,
    fcm_accepted: r.fcm.accepted,
    fcm_failed: r.fcm.failed,
    fcm_stale: r.fcm.stale,
    anon_fired: r.anon.fired,
    anon_accepted: r.anon.accepted,
    anon_stale: r.anon.stale,
    recipients_total: r.recipients_total,
    accepted_total: r.accepted_total,
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/broadcast-push.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck the touched files compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "broadcast-push|push.ts|push-fcm" || echo "clean"`
Expected: `clean`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/broadcast-push.ts src/lib/__tests__/broadcast-push.test.ts src/lib/push.ts src/lib/push-fcm.ts
git commit -m "feat: broadcast-push fan-out core + sendId payload field"
```

---

## Task 3: Broadcast send endpoint (`/api/admin/broadcast-push`)

Wires the core to Supabase: paginates the three subscription tables, inserts a pending `notification_sends` row to obtain the `send_id`, runs the broadcast, then updates the row with final counts.

**Files:**
- Create: `src/app/api/admin/broadcast-push/route.ts`

- [ ] **Step 1: Implement the route**

```ts
// src/app/api/admin/broadcast-push/route.ts
// Operator broadcast: send ONE push to the entire installed base (logged-in
// web + Android + anonymous web). CRON_SECRET-protected. Records a
// notification_sends row (dry runs included, for auditability).

import { createClient } from '@supabase/supabase-js'
import { paginatedSelect } from '@/lib/db-paginate'
import { sendPush } from '@/lib/push'
import { sendPushToFcmTokens } from '@/lib/push-fcm'
import { runBroadcast, resultToCountsRow, type BroadcastDeps, type WebSub } from '@/lib/broadcast-push'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const DEFAULT_ICON = 'https://padelnachos.com/padelnachos-logo-v2.png'

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await request.json().catch(() => ({}))
  const { title, body, url, label, dryRun } = raw as {
    title?: string; body?: string; url?: string; label?: string; dryRun?: boolean
  }
  if (!title || !body) {
    return Response.json({ error: 'title and body are required' }, { status: 400 })
  }

  // 1) Insert a pending row to obtain send_id (carried in the payload).
  const { data: row, error: insErr } = await supabase
    .from('notification_sends')
    .insert({ kind: 'broadcast', title, body, url: url ?? '/', label: label ?? null, dry_run: !!dryRun })
    .select('id')
    .single()
  if (insErr || !row) {
    return Response.json({ error: 'insert_failed', message: insErr?.message }, { status: 500 })
  }
  const sendId = row.id as string

  // 2) Build Supabase-backed deps.
  const deps: BroadcastDeps = {
    fetchWebSubs: () =>
      paginatedSelect<{ id: string; endpoint: string; keys: { p256dh: string; auth: string } }>(
        (s, e) => supabase.from('push_subscriptions').select('id, endpoint, keys').range(s, e),
        { what: 'push_subscriptions (broadcast)' },
      ),
    fetchFcmTokens: async () => {
      const rows = await paginatedSelect<{ device_token: string }>(
        (s, e) => supabase.from('native_push_subscriptions').select('device_token').range(s, e),
        { what: 'native_push_subscriptions (broadcast)' },
      )
      return rows.map((r) => r.device_token)
    },
    fetchAnonSubs: async () => {
      const rows = await paginatedSelect<{ id: string; endpoint: string; p256dh_key: string; auth_key: string }>(
        (s, e) => supabase.from('anon_push_subscriptions').select('id, endpoint, p256dh_key, auth_key').range(s, e),
        { what: 'anon_push_subscriptions (broadcast)' },
      )
      return rows.map<WebSub>((r) => ({
        id: r.id,
        endpoint: r.endpoint,
        keys: { p256dh: r.p256dh_key, auth: r.auth_key },
      }))
    },
    sendWeb: (sub, payload) => sendPush(sub, payload),
    sendFcm: (tokens, payload) =>
      sendPushToFcmTokens(tokens, { title: payload.title, body: payload.body, url: payload.url, tag: payload.tag, icon: payload.icon, sendId: payload.sendId }),
    cleanupWebStale: async (ids) => {
      await supabase.from('push_subscriptions').delete().in('id', ids)
    },
    cleanupFcmStale: async (tokens) => {
      await supabase.from('native_push_subscriptions').delete().in('device_token', tokens)
    },
    cleanupAnonStale: async (ids) => {
      await supabase.from('anon_push_subscriptions').delete().in('id', ids)
    },
  }

  // 3) Run + record final counts.
  const result = await runBroadcast(
    { title, body, url, label, icon: DEFAULT_ICON, sendId, dryRun: !!dryRun },
    deps,
  )
  await supabase.from('notification_sends').update(resultToCountsRow(result)).eq('id', sendId)

  console.log(
    `[Broadcast] send=${sendId} dry=${result.dry_run} recipients=${result.recipients_total} accepted=${result.accepted_total}`,
  )

  return Response.json({ ok: true, send_id: sendId, ...result })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "broadcast-push/route" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Manual dry-run smoke test against the dev server**

Start the dev server (`npm run dev`), then:
```bash
curl -s -X POST http://localhost:3002/api/admin/broadcast-push \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"title":"Test","body":"dry run","dryRun":true}' | npx json 2>/dev/null || \
curl -s -X POST http://localhost:3002/api/admin/broadcast-push \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"title":"Test","body":"dry run","dryRun":true}'
```
Expected: JSON with `ok:true`, a `send_id`, `dry_run:true`, and `recipients_total` equal to your current subscription count. No notification is delivered. Confirm a `dry_run=true` row exists in `notification_sends`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/broadcast-push/route.ts
git commit -m "feat: POST /api/admin/broadcast-push endpoint with dry-run"
```

---

## Task 4: Bake analytics into existing match notifications

Add one additive `notification_sends` insert at the end of `/api/push/notify`, populated from counters the route already computes. No delivery behavior changes.

**Files:**
- Modify: `src/app/api/push/notify/route.ts` (near the final `return Response.json(...)`, ~line 720)

- [ ] **Step 1: Add the insert before the final return**

In `src/app/api/push/notify/route.ts`, immediately **before** the closing `return Response.json({ ok: true, ... })` (the block starting around line 720), insert:

```ts
  // Persist a notification_sends analytics row (kind='match'). Additive —
  // purely observability; failure must never break delivery.
  try {
    await supabase.from('notification_sends').insert({
      kind: 'match',
      title: 'Match notification',
      body: null,
      url: null,
      metadata: {
        match_id: matchId,
        by_reason: { bookmark: bookmarkSent, follow: followSent },
        inapp_written: inappWritten,
      },
      web_fired: recipientReason.size,
      web_accepted: pushSent,
      web_stale: staleIds.length,
      fcm_fired: fcmSent + fcmFailed,
      fcm_accepted: fcmSent,
      fcm_failed: fcmFailed,
      fcm_stale: fcmStaleCleaned,
      anon_fired: anonSubs.length,
      anon_accepted: anonSent,
      anon_stale: anonStaleIds.length,
      recipients_total: recipientReason.size + anonSubs.length,
      accepted_total: pushSent + fcmSent + anonSent,
    })
  } catch (e) {
    console.error('[Push] notification_sends insert failed:', (e as Error).message)
  }
```

Note: `anonStaleIds` is already in scope (used in the final `console.log`). All other names (`matchId`, `bookmarkSent`, `followSent`, `inappWritten`, `recipientReason`, `pushSent`, `staleIds`, `fcmSent`, `fcmFailed`, `fcmStaleCleaned`, `anonSubs`, `anonSent`) are declared earlier in the function.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "push/notify/route" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/push/notify/route.ts
git commit -m "feat: record notification_sends row for match notifications"
```

---

## Task 5: Web click tracking

Carry `sendId` into the notification data in `public/sw.js`, beacon it on click, and add the receiving endpoint.

**Files:**
- Create: `src/app/api/push/click/route.ts`
- Modify: `public/sw.js`

- [ ] **Step 1: Implement the click endpoint**

```ts
// src/app/api/push/click/route.ts
// Beacon target for web push click-through. Unauthenticated (it's a
// navigator.sendBeacon / keepalive fetch from the service worker), but it
// only accepts a known send_id and stores no PII.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function POST(request: Request) {
  const { send_id, platform } = (await request.json().catch(() => ({}))) as {
    send_id?: string; platform?: string
  }
  if (!send_id) return Response.json({ ok: false }, { status: 400 })

  const { error } = await supabase
    .from('notification_clicks')
    .insert({ send_id, platform: platform ?? 'web' })
  if (error) {
    // Unknown send_id (FK violation) or transient — swallow, it's a beacon.
    return Response.json({ ok: false }, { status: 202 })
  }
  await supabase.rpc('increment_notification_clicks', { p_send_id: send_id })
  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Carry `sendId` into the notification data in `public/sw.js`**

In `public/sw.js`, in the `push` handler's `options` object, change the `data` line to include `sendId`:

```js
    data: { url: data.url ?? '/v3', sendId: data.sendId },
```

- [ ] **Step 3: Beacon on click in `public/sw.js`**

In the `notificationclick` handler, after `const url = event.notification.data?.url ?? '/v3'`, add:

```js
  const sendId = event.notification.data?.sendId
  if (sendId) {
    event.waitUntil(
      fetch('/api/push/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ send_id: sendId, platform: 'web' }),
        keepalive: true,
      }).catch(() => {}),
    )
  }
```

(This `event.waitUntil` runs alongside the existing one that focuses/opens the window — both are allowed.)

- [ ] **Step 4: Typecheck the route**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "push/click/route" || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Manual click round-trip**

With the dev server running, insert a known send via the broadcast dry-run from Task 3 (note its `send_id`), then simulate a click beacon:
```bash
curl -s -X POST http://localhost:3002/api/push/click \
  -H "Content-Type: application/json" \
  -d "{\"send_id\":\"<SEND_ID_FROM_DRY_RUN>\",\"platform\":\"web\"}"
```
Expected: `{"ok":true}`, and `notification_sends.clicks` for that row increments to 1; a `notification_clicks` row exists.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/push/click/route.ts public/sw.js
git commit -m "feat: web push click tracking (sw beacon + /api/push/click)"
```

---

## Task 6: Admin forward route (`apps/ops`)

Operator-auth proxy that forwards the compose payload to the main app with `CRON_SECRET`. Mirrors `trigger-translation-backfill`.

**Files:**
- Create: `apps/ops/src/app/api/internal/broadcast/route.ts`

- [ ] **Step 1: Implement the forward route**

```ts
// apps/ops/src/app/api/internal/broadcast/route.ts
// Server-side proxy: the Broadcast tab calls this; it forwards to
// padelnachos.com/api/admin/broadcast-push with the shared CRON_SECRET
// (never exposed to the browser). Mirrors trigger-translation-backfill.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const body = await req.json().catch(() => ({}))
  try {
    const r = await fetch('https://padelnachos.com/api/admin/broadcast-push', {
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

- [ ] **Step 2: Typecheck (apps/ops)**

Run: `cd apps/ops && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "internal/broadcast" || echo "clean"; cd ../..`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/broadcast/route.ts
git commit -m "feat(ops): broadcast forward proxy route"
```

---

## Task 7: Admin history query + Broadcast UI

Read recent `notification_sends` for the history table, then build the compose/dry-run/send/history page and register it in the nav.

**Files:**
- Create: `apps/ops/src/lib/broadcast-queries.ts`
- Create: `apps/ops/src/app/(app)/system/broadcast/page.tsx`
- Create: `apps/ops/src/app/(app)/system/broadcast/_components/BroadcastView.tsx`
- Modify: `apps/ops/src/components/shell/Rail.tsx`

- [ ] **Step 1: Implement the history query**

```ts
// apps/ops/src/lib/broadcast-queries.ts
import { createServiceClient } from './supabase'

export interface NotificationSendRow {
  id: string
  created_at: string
  kind: 'broadcast' | 'match'
  title: string
  label: string | null
  dry_run: boolean
  recipients_total: number
  accepted_total: number
  clicks: number
}

export async function listRecentSends(limit = 50): Promise<NotificationSendRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('notification_sends')
    .select('id, created_at, kind, title, label, dry_run, recipients_total, accepted_total, clicks')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listRecentSends: ${error.message}`)
  return (data ?? []) as NotificationSendRow[]
}
```

- [ ] **Step 2: Implement the route entry (server component)**

```tsx
// apps/ops/src/app/(app)/system/broadcast/page.tsx
import BroadcastView from './_components/BroadcastView'
import { listRecentSends } from '@/lib/broadcast-queries'

export const metadata = { title: 'Broadcast · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function BroadcastPage() {
  const sends = await listRecentSends()
  return <BroadcastView initialSends={sends} />
}
```

- [ ] **Step 3: Implement the client view**

```tsx
// apps/ops/src/app/(app)/system/broadcast/_components/BroadcastView.tsx
'use client'

import { useState } from 'react'
import type { NotificationSendRow } from '@/lib/broadcast-queries'

interface DryRunResult { recipients_total: number; web: { fired: number }; fcm: { fired: number }; anon: { fired: number } }

export default function BroadcastView({ initialSends }: { initialSends: NotificationSendRow[] }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('/')
  const [label, setLabel] = useState('')
  const [reach, setReach] = useState<DryRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  async function post(dryRun: boolean) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, url, label: label || undefined, dryRun }),
      })
      const json = await r.json()
      if (!r.ok) { setMsg(`Error: ${json.error ?? r.status}`); return null }
      return json
    } finally { setBusy(false) }
  }

  async function onDryRun() {
    const json = await post(true)
    if (json) { setReach(json); setMsg(`Reach: ${json.recipients_total} devices.`) }
  }

  async function onSend() {
    const json = await post(false)
    if (json) { setMsg(`Sent. Accepted ${json.accepted_total}/${json.recipients_total}.`); setReach(null); setConfirmText('') }
  }

  const canDryRun = title.trim() && body.trim() && !busy
  const armed = reach !== null && confirmText === 'SEND' && !busy

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <h1>Broadcast</h1>
        <p>Send one push to every installed device. Always dry-run first.</p>
      </header>

      <section className="ui-panel" style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
        <label>Title<input value={title} onChange={(e) => { setTitle(e.target.value); setReach(null) }} maxLength={80} /></label>
        <label>Body<textarea value={body} onChange={(e) => { setBody(e.target.value); setReach(null) }} maxLength={180} /></label>
        <label>Deep link URL<input value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label>Campaign label (optional)<input value={label} onChange={(e) => setLabel(e.target.value)} /></label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onDryRun} disabled={!canDryRun}>Dry run (count reach)</button>
        </div>

        {reach && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div>Reach: <strong>{reach.recipients_total}</strong> (web {reach.web.fired} · android {reach.fcm.fired} · anon {reach.anon.fired})</div>
            <label>Type SEND to confirm<input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></label>
            <button onClick={onSend} disabled={!armed} style={{ background: 'var(--lime)' }}>Send to everyone</button>
          </div>
        )}

        {msg && <p>{msg}</p>}
      </section>

      <section className="ui-panel">
        <h2>Recent sends</h2>
        <table className="ui-table">
          <thead><tr><th>When</th><th>Kind</th><th>Title</th><th>Reach</th><th>Accepted</th><th>Clicks</th><th>Dry</th></tr></thead>
          <tbody>
            {initialSends.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.created_at).toLocaleString()}</td>
                <td>{s.kind}</td>
                <td>{s.label ?? s.title}</td>
                <td>{s.recipients_total}</td>
                <td>{s.accepted_total}</td>
                <td>{s.clicks}</td>
                <td>{s.dry_run ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

Note: this uses plain elements + existing `ui-page`/`ui-panel`/`ui-table` classes for minimum coupling. If the codebase's `ui/` primitives (`PageHeader`, `Panel`, `Button`, `DataTable`, `Field`) are the established convention in sibling system pages, swap them in — check `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx` for the house style and match it.

- [ ] **Step 4: Register the nav item**

In `apps/ops/src/components/shell/Rail.tsx`, add to the `System` group's `items` array (after the `architecture` entry, around line 50):

```ts
    { href: '/system/broadcast', label: 'Broadcast', icon: 'bell' },
```

If `'bell'` is not a registered icon key in the Rail's icon map, use an existing one (e.g. `'heart'` or `'server'`) — check the icon switch in `Rail.tsx` and pick a valid key.

- [ ] **Step 5: Typecheck (apps/ops)**

Run: `cd apps/ops && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "broadcast|Rail" || echo "clean"; cd ../..`
Expected: `clean`.

- [ ] **Step 6: Visual verification**

Start the ops app (its dev command — check `apps/ops/package.json` `scripts.dev`, typically `npm run dev` from `apps/ops`). Log in as an operator, navigate to **System → Broadcast**. Confirm: the compose form renders, a dry run returns a reach count, the Send button is disabled until a dry run + typing `SEND`, and the Recent sends table lists the dry-run rows created in earlier tasks.

- [ ] **Step 7: Commit**

```bash
git add apps/ops/src/lib/broadcast-queries.ts "apps/ops/src/app/(app)/system/broadcast" apps/ops/src/components/shell/Rail.tsx
git commit -m "feat(ops): Broadcast tab — compose, dry-run, send, history"
```

---

## Task 8: Full-suite verification

- [ ] **Step 1: Run the unit suite**

Run: `npx vitest run src/lib/__tests__/broadcast-push.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 2: Lint the touched files**

Run: `npm run lint 2>&1 | tail -20`
Expected: no new errors in the files this plan created/modified.

- [ ] **Step 3: End-to-end self-send rehearsal (before any real blast)**

1. Send a test push to yourself: `curl -X POST http://localhost:3002/api/admin/test-push -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"email":"<your-email>","scenario":"premier"}'` — confirm it arrives.
2. From the Broadcast tab, dry-run → confirm reach count looks right.
3. Only then consider a real send.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: broadcast push verification fixups"
```

---

## Notes / deferred (per spec, out of scope)

- Audience filtering (locale/platform/logged-in vs anon).
- Scheduling / throttled delivery windows.
- Displayed/received tracking (service worker + native phone-home).
- Android click tracking (the `sendId` already rides in the FCM data block, so a future `PadelMessagingService` change can beacon it without server changes).
- Retention/cleanup cron for `notification_sends` / `notification_clicks`.
