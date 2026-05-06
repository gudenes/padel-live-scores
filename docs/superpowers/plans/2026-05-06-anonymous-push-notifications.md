# Anonymous Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anonymous users receive Web Push notifications for matches and players they follow on the device they used, without requiring sign-in.

**Architecture:** Two new tables (`anon_push_subscriptions` + `anon_bookmarks`) mirror the existing user-scoped shape. A `pn_device_id` UUID in localStorage keys all server-side records. Existing push-sender (`/api/push/notify`) gets a parallel UNION fan-out so authenticated and anonymous recipients are notified together. Sign-in migrates anon rows → user rows via the same flow `useFollowing` already uses for bookmarks. Whole feature gated on `pn_consent.push === true` from the cookie banner.

**Tech Stack:** Supabase (PostgreSQL + RLS), Next.js 16 App Router, web-push (existing `src/lib/push.ts`), Vitest (node env), TypeScript 5.

**Spec:** [docs/superpowers/specs/2026-05-06-anonymous-push-notifications-design.md](../specs/2026-05-06-anonymous-push-notifications-design.md)

---

## File Structure

### New files
- `supabase/migrations/20260506000001_anon_push_subscriptions.sql` — two tables, indexes, RLS, cleanup trigger
- `src/lib/anon-push.ts` — client helpers (`ensureSubscription`, `addBookmark`, `removeBookmark`, `unsubscribe`, `migrateToUser`)
- `src/lib/__tests__/anon-push.test.ts` — pure-helper tests
- `src/hooks/useAnonPush.ts` — hook wrapping the lib, gated on `useConsent().isPushAllowed()`
- `src/app/api/anon/push-subscriptions/route.ts` — POST (register + initial bookmarks), DELETE (unsubscribe)
- `src/app/api/anon/push-subscriptions/bookmarks/route.ts` — POST (add bookmark), DELETE (remove bookmark)
- `src/app/api/anon/push-subscriptions/migrate/route.ts` — POST (migrate device's anon subs → user subs on sign-in)
- `src/app/api/cron/anon-push-cleanup/route.ts` — weekly cron, deletes inactive rows

### Modified files
- `src/hooks/useFollowing.ts` — `toggle()` for anon users also calls `useAnonPush.add/removeBookmark`. On the first follow with consent + no permission set, calls `ensureSubscription()`. The existing sign-in migration extends to also call `migrateToUser()`.
- `src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx` — `handleEnable` now calls `ensureSubscription(currentFollows)` instead of just `Notification.requestPermission()`.
- `src/components/BookmarkToast.tsx` — anon-user "enable-push" CTA path no longer punts to sign-in. Calls `ensureSubscription()` directly.
- `src/app/api/push/notify/route.ts` — adds a parallel anon-recipient fan-out (queries `anon_bookmarks` joined with `anon_push_subscriptions` for the same match/players) and sends via the existing `sendPush()` helper.
- `vercel.json` — registers the new cleanup cron.

### LocalStorage flags

| Flag | Set when | Read by |
|---|---|---|
| `pn_device_id` | First successful subscription registration | All anon-push functions; sign-in migration |
| `pn_consent.push` (existing) | User consents via cookie banner | `useAnonPush` gate |
| `pn_push_prompted` (existing) | NotificationPromptSheet, BookmarkToast | Existing toast CTA gate |
| `pn_anon_push_endpoint` | After successful subscription | Used so `unsubscribe()` knows what endpoint to send to the server |

---

## Task 1: DB migration — anon push tables

**Why:** Both client and server code in subsequent tasks reference these tables. Land the schema first so the rest of the work has a target.

**Files:**
- Create: `supabase/migrations/20260506000001_anon_push_subscriptions.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260506000001_anon_push_subscriptions.sql`:

```sql
-- Anonymous push notification subscriptions.
--
-- Mirrors the user-scoped push_subscriptions + user_bookmarks shape but
-- keyed by a random localStorage UUID (pn_device_id) instead of user_id.
-- Lets pre-auth visitors receive Web Push for players/matches they follow
-- on the device they're using. Spec: 2026-05-06-anonymous-push-notifications-design.md.

CREATE TABLE anon_push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       UUID NOT NULL,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh_key      TEXT NOT NULL,
  auth_key        TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX anon_push_subscriptions_device_id_idx
  ON anon_push_subscriptions (device_id);

CREATE INDEX anon_push_subscriptions_last_seen_at_idx
  ON anon_push_subscriptions (last_seen_at);

CREATE TABLE anon_bookmarks (
  device_id       UUID NOT NULL,
  bookmark_type   TEXT NOT NULL CHECK (bookmark_type IN ('player','match')),
  target_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, bookmark_type, target_id)
);

-- Lookup index for the push-sender JOIN: "who follows player X" /
-- "who bookmarked match Y".
CREATE INDEX anon_bookmarks_target_idx
  ON anon_bookmarks (bookmark_type, target_id);

-- RLS: anon-key + auth-key clients get NO access. Only the service role
-- (used by API routes + crons) reads/writes these tables.
ALTER TABLE anon_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE anon_bookmarks         ENABLE ROW LEVEL SECURITY;

-- Cascade delete: when a subscription row is removed (manual unsubscribe,
-- 410-from-push-service cleanup, or the 90-day cron), drop the
-- corresponding anon_bookmarks rows for that device — but only when no
-- other subscription rows for the same device_id remain. (A device with
-- multiple browsers / PWA installs may have multiple subscription rows;
-- bookmarks should survive until the last one goes.)
CREATE OR REPLACE FUNCTION delete_anon_bookmarks_for_device()
RETURNS trigger AS $$
BEGIN
  DELETE FROM anon_bookmarks
   WHERE device_id = OLD.device_id
     AND NOT EXISTS (
       SELECT 1 FROM anon_push_subscriptions
        WHERE device_id = OLD.device_id AND id <> OLD.id
     );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER anon_subs_cleanup_bookmarks
AFTER DELETE ON anon_push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION delete_anon_bookmarks_for_device();

COMMENT ON TABLE anon_push_subscriptions IS
  'Anonymous Web Push subscriptions, keyed by localStorage device_id (UUID). Spec 2026-05-06.';
COMMENT ON TABLE anon_bookmarks IS
  'Anonymous follows for push delivery. Migrated to user_bookmarks on sign-in.';
```

- [ ] **Step 2: Apply the migration locally**

This codebase applies migrations via the Supabase dashboard (per CLAUDE.md). For the implementation plan, it's sufficient to commit the file — the user will apply it to dev / staging / prod via the dashboard before merging the PR that depends on it.

Verify the SQL parses by running it through a syntax check:

```bash
# Sanity: no obvious typos. The migration won't execute here, but a
# missing semicolon or unbalanced parens would surface.
grep -c 'CREATE\|ALTER\|COMMENT' supabase/migrations/20260506000001_anon_push_subscriptions.sql
```
Expected: at least 8 (2 tables, 3 indexes, 2 RLS enables, 1 trigger, 1 function, 2 comments — depending on how grep counts).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260506000001_anon_push_subscriptions.sql
git commit -m "$(cat <<'EOF'
feat(anon-push): migration for anon_push_subscriptions + anon_bookmarks

Two tables mirroring the user-scoped shape, keyed by localStorage
device_id (UUID). RLS denies all client access (service-role only).
Cascade-delete trigger drops anon_bookmarks for a device when the
last subscription row goes (handles manual unsubscribe, 410-stale
cleanup, and the 90-day cron uniformly).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure client helpers + tests

**Why:** Most of `src/lib/anon-push.ts` is async I/O (network + Notification API), but a few pieces are pure and testable: device-ID generation, the "should we even try" gate, and the migration-payload builder used by `migrateToUser`. Extract them into pure functions with unit tests.

**Files:**
- Create: `src/lib/anon-push.ts` (only the pure parts in this task)
- Create: `src/lib/__tests__/anon-push.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/anon-push.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildMigrationPayload,
  isPushSupported,
  type AnonBookmark,
} from '../anon-push'

describe('buildMigrationPayload', () => {
  it('returns null when no device_id is provided', () => {
    expect(buildMigrationPayload(null)).toBeNull()
    expect(buildMigrationPayload('')).toBeNull()
  })

  it('builds the migrate payload from a device_id', () => {
    const out = buildMigrationPayload('11111111-2222-3333-4444-555555555555')
    expect(out).toEqual({ device_id: '11111111-2222-3333-4444-555555555555' })
  })
})

describe('isPushSupported', () => {
  // Tests run in node env (no window). The function should return false
  // gracefully when push APIs aren't available, not throw.
  it('returns false in node / non-browser env', () => {
    expect(isPushSupported()).toBe(false)
  })

  it('returns false when ServiceWorker / PushManager / Notification missing', () => {
    // Build a minimal mock window that's missing each piece in turn.
    const orig = (globalThis as any).window
    try {
      ;(globalThis as any).window = { /* nothing */ }
      expect(isPushSupported()).toBe(false)
      ;(globalThis as any).window = { Notification: function () {} }
      expect(isPushSupported()).toBe(false)
      ;(globalThis as any).window = {
        Notification: function () {},
        PushManager: function () {},
      }
      expect(isPushSupported()).toBe(false)
    } finally {
      ;(globalThis as any).window = orig
    }
  })

  it('returns true when all three APIs are present', () => {
    const orig = (globalThis as any).window
    const origNav = (globalThis as any).navigator
    try {
      ;(globalThis as any).window = {
        Notification: function () {},
        PushManager: function () {},
      }
      ;(globalThis as any).navigator = { serviceWorker: {} }
      expect(isPushSupported()).toBe(true)
    } finally {
      ;(globalThis as any).window = orig
      ;(globalThis as any).navigator = origNav
    }
  })
})

// AnonBookmark type smoke test — ensures the exported shape matches
// the bookmark types the rest of the system uses.
describe('AnonBookmark', () => {
  it('accepts player and match types', () => {
    const a: AnonBookmark = { type: 'player', target_id: 'abc' }
    const b: AnonBookmark = { type: 'match', target_id: 'def' }
    expect(a.type).toBe('player')
    expect(b.type).toBe('match')
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/lib/__tests__/anon-push.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure helpers**

Create `src/lib/anon-push.ts`:

```ts
// Anonymous Web Push helpers — client-side only.
//
// This module has two layers:
//   1. PURE helpers (this commit): support detection + payload builders.
//      Unit-tested against vitest in node env.
//   2. SIDE-EFFECTFUL helpers (next commit): ensureSubscription,
//      addBookmark, removeBookmark, unsubscribe, migrateToUser. These
//      touch localStorage, the Notification API, the service worker,
//      and `/api/anon/*`. They're async, mostly fire-and-forget, and
//      gated on `pn_consent.push === true` AND `Notification.permission`.

export type AnonBookmarkType = 'player' | 'match'

export interface AnonBookmark {
  type: AnonBookmarkType
  target_id: string
}

export interface MigrationPayload {
  device_id: string
}

/**
 * Builds the request body for POST /api/anon/push-subscriptions/migrate.
 * Returns null if there's no device_id to migrate (nothing to do).
 */
export function buildMigrationPayload(deviceId: string | null): MigrationPayload | null {
  if (!deviceId) return null
  return { device_id: deviceId }
}

/**
 * Returns true when the browser supports the Web Push pipeline:
 *   - Service Worker
 *   - Push Manager
 *   - Notification API
 *
 * iOS Safari typically returns false unless the page is installed as a
 * PWA — that's the documented v1 gap (see spec §non-goals). Anything
 * non-browser (node, tests) returns false too.
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (typeof w.Notification === 'undefined') return false
  if (typeof w.PushManager === 'undefined') return false
  if (typeof navigator === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (navigator as any).serviceWorker === 'undefined') return false
  return true
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/lib/__tests__/anon-push.test.ts`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/anon-push.ts src/lib/__tests__/anon-push.test.ts
git commit -m "$(cat <<'EOF'
feat(anon-push): pure helpers — buildMigrationPayload, isPushSupported

First slice of src/lib/anon-push.ts. The side-effectful flow
(ensureSubscription, addBookmark, etc.) lands in the next commit;
shipping the pure pieces first lets us test them in node-env vitest
without mocking the Notification + service-worker APIs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: API route — register subscription + initial bookmarks

**Why:** Server-side endpoint that the client calls on first push registration. Upserts the subscription, bulk-inserts the user's current follows.

**Files:**
- Create: `src/app/api/anon/push-subscriptions/route.ts`

- [ ] **Step 1: Write the route handler**

Create `src/app/api/anon/push-subscriptions/route.ts`:

```ts
// /api/anon/push-subscriptions
//
// Anonymous Web Push subscription registration + unsubscribe.
//
// POST: register the subscription and bulk-insert initial bookmarks.
//   Body: { device_id, endpoint, keys: {p256dh,auth}, user_agent, bookmarks: [{type,target_id}] }
//   Idempotent on `endpoint` — same device re-registering replaces the row.
//   Bookmarks insert with ON CONFLICT DO NOTHING so it's safe to call
//   with the user's full follow set even on re-register.
//
// DELETE: unsubscribe a single endpoint.
//   Body: { endpoint }
//   The cascade trigger handles anon_bookmarks cleanup.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface PostBody {
  device_id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
  user_agent?: string
  bookmarks?: Array<{ type: 'player' | 'match'; target_id: string }>
}

interface DeleteBody {
  endpoint: string
}

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(req: Request) {
  let body: Partial<PostBody>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isUuid(body.device_id)) {
    return Response.json({ error: 'Invalid or missing device_id' }, { status: 400 })
  }
  if (typeof body.endpoint !== 'string' || !body.endpoint.startsWith('http')) {
    return Response.json({ error: 'Invalid or missing endpoint' }, { status: 400 })
  }
  if (!body.keys || typeof body.keys.p256dh !== 'string' || typeof body.keys.auth !== 'string') {
    return Response.json({ error: 'Invalid or missing keys' }, { status: 400 })
  }

  const { error: subErr } = await supabase
    .from('anon_push_subscriptions')
    .upsert(
      {
        device_id: body.device_id,
        endpoint: body.endpoint,
        p256dh_key: body.keys.p256dh,
        auth_key: body.keys.auth,
        user_agent: body.user_agent ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )

  if (subErr) {
    console.error('[anon-push] upsert subscription failed', subErr)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  // Bulk-insert bookmarks. Filter to types we accept; the DB CHECK
  // constraint also enforces this server-side.
  if (Array.isArray(body.bookmarks) && body.bookmarks.length > 0) {
    const rows = body.bookmarks
      .filter(b =>
        (b.type === 'player' || b.type === 'match') &&
        isUuid(b.target_id),
      )
      .map(b => ({
        device_id: body.device_id,
        bookmark_type: b.type,
        target_id: b.target_id,
      }))

    if (rows.length > 0) {
      const { error: bmErr } = await supabase
        .from('anon_bookmarks')
        .upsert(rows, { onConflict: 'device_id,bookmark_type,target_id' })
      if (bmErr) {
        console.error('[anon-push] upsert bookmarks failed', bmErr)
        // Subscription succeeded; bookmarks failed — return a partial-success
        // signal so the client can retry the bookmarks step on next toggle.
        return Response.json({ ok: true, bookmarks_failed: true })
      }
    }
  }

  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  let body: Partial<DeleteBody>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.endpoint !== 'string' || !body.endpoint.startsWith('http')) {
    return Response.json({ error: 'Invalid or missing endpoint' }, { status: 400 })
  }

  await supabase
    .from('anon_push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint)
  // Trigger handles anon_bookmarks cleanup. We always return ok — DELETE
  // for an endpoint that doesn't exist is a no-op, not an error.
  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/api/anon/push-subscriptions/route.ts'
git commit -m "$(cat <<'EOF'
feat(anon-push): API route — register / unsubscribe

POST upserts the subscription on `endpoint` and bulk-upserts the
user's initial bookmark set. DELETE removes a subscription by
endpoint; the migration's cascade trigger handles anon_bookmarks
cleanup automatically. Service-role only (RLS denies client access).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: API route — bookmark add / remove

**Why:** Once the subscription is registered, every toggle on the client needs to PATCH the server-side bookmark list so the push sender knows what to deliver.

**Files:**
- Create: `src/app/api/anon/push-subscriptions/bookmarks/route.ts`

- [ ] **Step 1: Write the route handler**

Create `src/app/api/anon/push-subscriptions/bookmarks/route.ts`:

```ts
// /api/anon/push-subscriptions/bookmarks
//
// Add or remove a single anonymous bookmark for a registered device.
//
// POST: insert ON CONFLICT DO NOTHING.
// DELETE: remove the matching row.
//
// Both routes are idempotent. They do NOT verify that the device has a
// live subscription — bookmarks can exist without a subscription if the
// browser revoked permission. Push delivery naturally only reaches
// devices with both a row in anon_push_subscriptions AND a matching
// anon_bookmarks row, so this is safe.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface BookmarkBody {
  device_id: string
  type: 'player' | 'match'
  target_id: string
}

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function validateBody(raw: unknown): BookmarkBody | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (!isUuid(b.device_id)) return null
  if (b.type !== 'player' && b.type !== 'match') return null
  if (!isUuid(b.target_id)) return null
  return { device_id: b.device_id, type: b.type, target_id: b.target_id }
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const body = validateBody(raw)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const { error } = await supabase
    .from('anon_bookmarks')
    .upsert(
      {
        device_id: body.device_id,
        bookmark_type: body.type,
        target_id: body.target_id,
      },
      { onConflict: 'device_id,bookmark_type,target_id' },
    )

  if (error) {
    console.error('[anon-push] bookmark insert failed', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const body = validateBody(raw)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  await supabase
    .from('anon_bookmarks')
    .delete()
    .eq('device_id', body.device_id)
    .eq('bookmark_type', body.type)
    .eq('target_id', body.target_id)
  // Always return ok — deleting a non-existent row is a no-op.
  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/api/anon/push-subscriptions/bookmarks/route.ts'
git commit -m "$(cat <<'EOF'
feat(anon-push): API route — add / remove bookmarks

POST upserts a single (device_id, bookmark_type, target_id) row.
DELETE removes it. Both idempotent, both validate via the same
isUuid + literal-type checks. Hand-shaken with the DB CHECK
constraint on bookmark_type.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: API route — sign-in migration

**Why:** When an anonymous user signs in, we need to copy their `anon_push_subscriptions` rows into `push_subscriptions` (now keyed by `user_id`) and delete the originals. Without this, sign-in would orphan the subscription on the device — the user would silently stop receiving push.

**Files:**
- Create: `src/app/api/anon/push-subscriptions/migrate/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/anon/push-subscriptions/migrate/route.ts`:

```ts
// POST /api/anon/push-subscriptions/migrate
//
// Move all anon_push_subscriptions for a given device_id into the
// authenticated push_subscriptions table under the current user, then
// delete the anon rows. The cascade trigger drops anon_bookmarks for
// the device automatically.
//
// Called by the client immediately after a successful sign-in (in the
// existing useFollowing migration block).
//
// Auth: requires a signed-in session; we read user.id from getUserOrFail
// rather than trusting the client.

import { getUserOrFail } from '../../../_auth'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(req: Request) {
  const { user, error: authErr } = await getUserOrFail()
  if (authErr) return authErr

  let body: { device_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isUuid(body.device_id)) {
    return Response.json({ error: 'Invalid or missing device_id' }, { status: 400 })
  }
  const deviceId = body.device_id

  // Fetch all anon subscriptions for this device.
  const { data: anonSubs, error: fetchErr } = await adminSupabase
    .from('anon_push_subscriptions')
    .select('endpoint, p256dh_key, auth_key')
    .eq('device_id', deviceId)

  if (fetchErr) {
    console.error('[anon-push] migrate fetch failed', fetchErr)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  const subs = anonSubs ?? []
  if (subs.length === 0) {
    return Response.json({ ok: true, migrated: 0 })
  }

  // Insert into the authenticated table. push_subscriptions.keys is
  // stored as a JSON object — match the shape used by the existing
  // /api/user/push-subscriptions POST.
  const userRows = subs.map(s => ({
    user_id: user.id,
    endpoint: s.endpoint,
    keys: { p256dh: s.p256dh_key, auth: s.auth_key },
  }))

  const { error: insertErr } = await adminSupabase
    .from('push_subscriptions')
    .upsert(userRows, { onConflict: 'user_id,endpoint' })

  if (insertErr) {
    console.error('[anon-push] migrate insert failed', insertErr)
    // Don't delete the anon rows — keeping them means the next sign-in
    // attempt can retry. Same retry pattern useFollowing migration uses.
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  // Delete anon subscriptions for this device. Trigger cascades the
  // anon_bookmarks rows.
  const { error: deleteErr } = await adminSupabase
    .from('anon_push_subscriptions')
    .delete()
    .eq('device_id', deviceId)

  if (deleteErr) {
    console.error('[anon-push] migrate delete failed', deleteErr)
    // Insert succeeded but delete didn't — the user will get duplicate
    // notifications until cleanup catches up. Log and continue.
    return Response.json({ ok: true, migrated: subs.length, delete_failed: true })
  }

  return Response.json({ ok: true, migrated: subs.length })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/api/anon/push-subscriptions/migrate/route.ts'
git commit -m "$(cat <<'EOF'
feat(anon-push): API route — sign-in migration

Copies all anon_push_subscriptions rows for a device_id into the
authenticated push_subscriptions table under the requesting user,
then deletes the anon rows. The cascade trigger drops anon_bookmarks.

Idempotent on the user_id + endpoint composite unique constraint —
calling twice (e.g., from a flaky network) results in upsert no-op
+ second delete that's already gone.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Side-effectful client helpers in `anon-push.ts`

**Why:** Add the async client functions (`ensureSubscription`, `addBookmark`, `removeBookmark`, `unsubscribe`, `migrateToUser`) that wrap the API routes from Tasks 3–5 and the browser Push APIs.

**Files:**
- Modify: `src/lib/anon-push.ts` (extends Task 2's pure helpers)

- [ ] **Step 1: Append the side-effectful helpers**

Append to `src/lib/anon-push.ts` (keep the existing pure helpers from Task 2):

```ts
// ── Side-effectful helpers ────────────────────────────────────────
//
// All of the below are no-ops when:
//   - typeof window === 'undefined' (SSR)
//   - isPushSupported() returns false (browser missing APIs)
// In addition, ensureSubscription is a no-op when the user hasn't
// granted push consent (caller checks via useConsent before calling).

const DEVICE_ID_KEY = 'pn_device_id'
const ENDPOINT_KEY = 'pn_anon_push_endpoint'

function getOrCreateDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(DEVICE_ID_KEY)
  } catch {
    return null
  }
}

// urlBase64 → Uint8Array, used by pushManager.subscribe(applicationServerKey).
// Same util the existing usePushNotifications hook ships.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Register a Web Push subscription for the anonymous device and POST it
 * to the server with the user's current bookmark set. Triggers the
 * native browser permission prompt if Notification.permission is
 * 'default'.
 *
 * Returns true if subscription is now active. Caller is responsible for
 * checking pn_consent.push BEFORE calling this — we don't double-check
 * here because callers (NotificationPromptSheet, BookmarkToast) often
 * have additional context for the UX flow.
 */
export async function ensureSubscription(initialBookmarks: AnonBookmark[]): Promise<boolean> {
  if (!isPushSupported()) return false

  // Permission prompt — only fire if not already decided.
  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      return false // iOS PWA edge case
    }
  }
  if (permission !== 'granted') return false

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) {
    console.error('[anon-push] VAPID public key not configured')
    return false
  }

  const deviceId = getOrCreateDeviceId()
  if (!deviceId) return false

  let registration: ServiceWorkerRegistration
  try {
    registration = await navigator.serviceWorker.ready
  } catch {
    return false
  }

  let subscription: PushSubscription
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    })
  } catch (err) {
    console.error('[anon-push] pushManager.subscribe failed', err)
    return false
  }

  const subJson = subscription.toJSON()
  const keys = subJson.keys as { p256dh?: string; auth?: string } | undefined
  if (!keys?.p256dh || !keys?.auth) return false

  const res = await fetch('/api/anon/push-subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceId,
      endpoint: subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      user_agent: navigator.userAgent,
      bookmarks: initialBookmarks,
    }),
  }).catch(() => null)

  if (!res || !res.ok) {
    console.error('[anon-push] register POST failed')
    return false
  }

  // Cache the endpoint so unsubscribe knows what to send.
  try {
    localStorage.setItem(ENDPOINT_KEY, subscription.endpoint)
  } catch {}
  return true
}

/** Add a single bookmark. No-op if no device_id is registered. */
export async function addBookmark(b: AnonBookmark): Promise<void> {
  const deviceId = getDeviceId()
  if (!deviceId) return
  await fetch('/api/anon/push-subscriptions/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, type: b.type, target_id: b.target_id }),
  }).catch(() => null)
}

/** Remove a single bookmark. No-op if no device_id is registered. */
export async function removeBookmark(b: AnonBookmark): Promise<void> {
  const deviceId = getDeviceId()
  if (!deviceId) return
  await fetch('/api/anon/push-subscriptions/bookmarks', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, type: b.type, target_id: b.target_id }),
  }).catch(() => null)
}

/**
 * Unsubscribe from Web Push and remove the server-side subscription
 * for this device. Used when the user revokes push consent.
 */
export async function unsubscribe(): Promise<void> {
  if (typeof window === 'undefined') return
  let endpoint: string | null = null
  try {
    endpoint = localStorage.getItem(ENDPOINT_KEY)
  } catch {}
  if (endpoint) {
    await fetch('/api/anon/push-subscriptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => null)
    try { localStorage.removeItem(ENDPOINT_KEY) } catch {}
  }
  // Best-effort browser-side unsubscribe — keeps the OS notification
  // permission unchanged but voids the push subscription.
  if (isPushSupported()) {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()
    } catch {}
  }
}

/**
 * Migrate this device's anon subscriptions to the now-signed-in user.
 * Called from the existing useFollowing sign-in migration block.
 */
export async function migrateToUser(): Promise<void> {
  const deviceId = getDeviceId()
  const payload = buildMigrationPayload(deviceId)
  if (!payload) return
  await fetch('/api/anon/push-subscriptions/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => null)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run all anon-push tests (still passing for the pure helpers)**

Run: `npx vitest run src/lib/__tests__/anon-push.test.ts`
Expected: 5 tests passing (no new tests for the side-effectful code in this slice — those would require a DOM mock and are covered manually).

- [ ] **Step 4: Commit**

```bash
git add src/lib/anon-push.ts
git commit -m "$(cat <<'EOF'
feat(anon-push): client helpers — ensureSubscription, add/removeBookmark, unsubscribe, migrateToUser

Side-effectful layer of src/lib/anon-push.ts. Each function is an
explicit no-op outside the browser or when push isn't supported.
Hooks into the API routes (Tasks 3-5), the Notification API, the
service worker, and pushManager.subscribe.

Caller is responsible for the consent gate (typically via
useConsent().isPushAllowed() in the React layer).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `useAnonPush` hook

**Why:** React-friendly wrapper around the `anon-push` lib. Gates everything on `useConsent().isPushAllowed()` so consumers don't need to remember.

**Files:**
- Create: `src/hooks/useAnonPush.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useAnonPush.ts`:

```ts
'use client'
// useAnonPush — React wrapper around src/lib/anon-push.ts.
//
// Exposes memoised callbacks that automatically gate on the user's
// cookie-banner push consent (Spec 1) AND browser support. Consumers
// (useFollowing, NotificationPromptSheet, BookmarkToast) call the
// returned functions without re-implementing the gating logic.

import { useCallback } from 'react'
import { useConsent } from '@/hooks/useConsent'
import {
  ensureSubscription as libEnsureSubscription,
  addBookmark as libAddBookmark,
  removeBookmark as libRemoveBookmark,
  unsubscribe as libUnsubscribe,
  migrateToUser as libMigrateToUser,
  isPushSupported,
  type AnonBookmark,
} from '@/lib/anon-push'

export function useAnonPush() {
  const { isPushAllowed } = useConsent()

  const ensureSubscription = useCallback(
    async (initialBookmarks: AnonBookmark[]): Promise<boolean> => {
      if (!isPushAllowed()) return false
      return libEnsureSubscription(initialBookmarks)
    },
    [isPushAllowed],
  )

  const addBookmark = useCallback(
    async (b: AnonBookmark): Promise<void> => {
      if (!isPushAllowed()) return
      return libAddBookmark(b)
    },
    [isPushAllowed],
  )

  const removeBookmark = useCallback(
    async (b: AnonBookmark): Promise<void> => {
      if (!isPushAllowed()) return
      return libRemoveBookmark(b)
    },
    [isPushAllowed],
  )

  const unsubscribe = useCallback(async (): Promise<void> => {
    return libUnsubscribe()
  }, [])

  const migrateToUser = useCallback(async (): Promise<void> => {
    return libMigrateToUser()
  }, [])

  return {
    supported: isPushSupported(),
    pushAllowed: isPushAllowed(),
    ensureSubscription,
    addBookmark,
    removeBookmark,
    unsubscribe,
    migrateToUser,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAnonPush.ts
git commit -m "$(cat <<'EOF'
feat(anon-push): useAnonPush hook

React wrapper around src/lib/anon-push.ts. Memoised callbacks gate
on useConsent().isPushAllowed() so consumers don't need to repeat
the consent check at every call site. unsubscribe + migrateToUser
are NOT consent-gated — those are cleanup paths that should run
regardless (e.g., user toggles consent off → unsubscribe should fire).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `useFollowing.toggle` to call anon-push

**Why:** Whenever an anonymous user follows / unfollows a player or match, the server-side anon_bookmarks row must update so the push sender knows what to deliver. Also, on the FIRST follow with consent + no permission yet, fire the native push prompt + subscription register.

**Files:**
- Modify: `src/hooks/useFollowing.ts`

- [ ] **Step 1: Read current `toggle` implementation**

Run: `sed -n '160,260p' src/hooks/useFollowing.ts`

Locate the `toggle` callback. Confirm where the localStorage write happens (anonymous path) and where the DB POST/DELETE happens (authenticated path).

- [ ] **Step 2: Add the anon-push hooks at the top of the hook body**

Near the top of the `useFollowing` function body (after `const { user } = useAuth()`), add:

```ts
import { useAnonPush } from '@/hooks/useAnonPush'
```
(at the top of the file, alongside existing hook imports)

And inside the `useFollowing` body, after the `useAuth` line:

```ts
const anonPush = useAnonPush()
```

- [ ] **Step 3: Wire add/remove into the toggle**

Inside the `toggle` callback, after the optimistic `setStore` block AND only on the anonymous path (`!user`), and only for `'player'` / `'match'` types, fire the corresponding `anonPush.addBookmark` / `removeBookmark` call. Also handle the first-follow ensureSubscription trigger.

Find the existing block in `toggle` that starts with `if (!user || type === 'news_source') {` (the localStorage sync). Right after the entire `setStore(prev => …)` block returns, add this anon-push side-effect:

```ts
// Anonymous push side-effect: keep the server-side anon_bookmarks list
// in sync with the user's localStorage follows so the push sender can
// reach them. First follow with consent fires the permission prompt +
// subscription register; subsequent toggles are PATCHes.
if (!user && (type === 'player' || type === 'match')) {
  const bookmark = { type, target_id: targetId }
  if (isCurrently) {
    // unfollow → remove server-side
    void anonPush.removeBookmark(bookmark)
  } else {
    // follow → ensure subscription if first time, then add bookmark
    if (anonPush.pushAllowed && anonPush.supported) {
      // Read updated localStorage follows so the initial bookmark set
      // includes the entry we just added.
      const local = readLocalStorage()
      const initial: { type: 'player' | 'match'; target_id: string }[] = [
        ...local.players.map(id => ({ type: 'player' as const, target_id: id })),
        ...local.matches.map(id => ({ type: 'match' as const, target_id: id })),
      ]
      // ensureSubscription is idempotent — it returns immediately if
      // a subscription already exists. addBookmark fires after, in case
      // the subscription was already there.
      void (async () => {
        await anonPush.ensureSubscription(initial)
        await anonPush.addBookmark(bookmark)
      })()
    } else {
      // No push consent / unsupported browser → still try to add the
      // bookmark in case a subscription is already registered (rare
      // but possible if user revokes-then-re-grants consent).
      void anonPush.addBookmark(bookmark)
    }
  }
}
```

Add this AFTER the `setStore(...)` block but BEFORE the existing `if (!silent && type !== 'news_source' && typeof window !== 'undefined')` toast-dispatch block.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFollowing.ts
git commit -m "$(cat <<'EOF'
feat(anon-push): wire useFollowing.toggle to anon push helpers

Anonymous follows now also write to anon_bookmarks server-side so
push delivery has a target list. First follow with consent fires
the native push permission prompt and registers the subscription;
subsequent toggles are individual PATCHes. All paths fire-and-forget
via void — local follow state stays the source of truth and
network failures don't block the UI.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Extend sign-in migration to call `migrateToUser`

**Why:** The existing useFollowing migration already moves localStorage follows into `user_bookmarks`. Add the parallel call to migrate `anon_push_subscriptions` → `push_subscriptions` so the user keeps receiving push under their `user_id`.

**Files:**
- Modify: `src/hooks/useFollowing.ts` (the `load()` function inside the main `useEffect`)

- [ ] **Step 1: Locate the existing migration block**

Run: `grep -n 'computeFollowMigration\|pn_migrated_to_user_' src/hooks/useFollowing.ts | head -5`

Look at the lines where the migration runs and where the per-user flag is set. The migration block lives inside the `if (userId) { ... if (!alreadyMigrated) { ... } }` chain.

- [ ] **Step 2: Add `anonPush.migrateToUser()` to the success path**

Inside `load()`, immediately after the existing flag-set:

```ts
if (allSucceeded) {
  try {
    localStorage.setItem(migrationFlagKey, '1')
  } catch {}
}
```

…add:

```ts
// Also migrate the device's anon push subscriptions (Spec 2). This is
// independent of the bookmark migration above — even if no localStorage
// follows existed, the device might still have an anon_push_subscriptions
// row from a previous browse session. The endpoint is a no-op when no
// device_id is set.
void anonPush.migrateToUser()
```

`anonPush` is in scope from Task 8 (we added `const anonPush = useAnonPush()` at the top of the hook body).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFollowing.ts
git commit -m "$(cat <<'EOF'
feat(anon-push): migrate anon subscriptions on sign-in

Extends the existing useFollowing sign-in migration (49cb351) to
also call anonPush.migrateToUser(). Independent of the bookmark
migration — even if localStorage was empty, the device may still
have an anon push subscription from a prior session. Fire-and-forget
via void; failures log and the device's anon row stays intact for
retry on next sign-in event.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update `NotificationPromptSheet` to call `ensureSubscription`

**Why:** Today the picker's notification sheet only calls `Notification.requestPermission()` — it captures the OS-level grant but doesn't register a server-side subscription. With anon push live, "Enable" should subscribe the device for real.

**Files:**
- Modify: `src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx`

- [ ] **Step 1: Read current handleEnable**

Run: `cat 'src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx' | head -50`

Locate `handleEnable`. Currently it just calls `Notification.requestPermission()` and resolves with the granted boolean.

- [ ] **Step 2: Replace `handleEnable` with the subscription flow**

Replace the existing `handleEnable` with this version. The component will need two new things from props or context: the user's current bookmarks (so the initial subscription registers them) and the anon-push hook.

Add the import at the top of the file (after existing imports):

```ts
import { useFollowing } from '@/hooks/useFollowing'
import { useAnonPush } from '@/hooks/useAnonPush'
```

Inside the component body (top), after the existing `useTranslations` line:

```ts
const { getFollowed } = useFollowing()
const anonPush = useAnonPush()
```

Replace the existing `handleEnable` body with:

```ts
const handleEnable = async () => {
  try {
    localStorage.setItem('pn_push_prompted', '1')
  } catch {}
  let granted = false
  // Build the initial bookmark snapshot so the server-side
  // anon_bookmarks list is seeded with the user's current follows.
  const initial = [
    ...getFollowed('player').map(id => ({ type: 'player' as const, target_id: id })),
    ...getFollowed('match').map(id => ({ type: 'match' as const, target_id: id })),
  ]
  granted = await anonPush.ensureSubscription(initial)
  onResolve(granted)
}
```

`ensureSubscription` returns true iff:
1. Push is supported in the browser
2. Notification.permission ends up 'granted'
3. The subscription was successfully registered with the server

So `granted` here means the same thing the old version meant, plus the server-side subscription is now in place.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx'
git commit -m "$(cat <<'EOF'
feat(anon-push): wire picker NotificationPromptSheet to ensureSubscription

handleEnable now calls anonPush.ensureSubscription with the user's
current follow set, registering the device-scoped anon_push_subscriptions
row + bulk-inserting the initial anon_bookmarks. Closes the broken-
promise gap from the picker rollout — anonymous users who tap "Enable"
will now actually receive push notifications for their picked players.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update `BookmarkToast` "enable-push" CTA path

**Why:** Today when an anon user taps "Enable alerts" on a bookmark toast, the code punts to a sign-in flow (`PUSH_SIGNIN_PENDING_KEY` → opens login sheet). Now the toast can register a real subscription on the spot.

**Files:**
- Modify: `src/components/BookmarkToast.tsx`

- [ ] **Step 1: Locate the `handleCta` function**

Run: `grep -n 'handleCta\|enable-push\|PUSH_SIGNIN_PENDING_KEY' src/components/BookmarkToast.tsx | head -10`

Find the `handleCta` function — it currently has separate branches for authenticated and anonymous users.

- [ ] **Step 2: Update the anonymous branch**

Find the block that starts with:

```ts
if (!user) {
  // Anonymous — open sign-in sheet; remember the push intent so we can
  // surface the permission prompt once the session lands.
  try { localStorage.setItem(PUSH_SIGNIN_PENDING_KEY, '1') } catch {}
  openLoginSheet()
  onDismiss()
  return
}
```

Replace it with:

```ts
if (!user) {
  // Anonymous — register an anon push subscription on the spot. The
  // user's current bookmarks become the initial anon_bookmarks set so
  // they immediately start receiving push for things they already follow.
  // No sign-in punt: anon push is a first-class path post-Spec 2.
  const initial = [
    ...getFollowed('player').map(id => ({ type: 'player' as const, target_id: id })),
    ...getFollowed('match').map(id => ({ type: 'match' as const, target_id: id })),
  ]
  await anonPush.ensureSubscription(initial)
  onDismiss()
  return
}
```

This requires `anonPush` and `getFollowed` to be in scope. Find where the existing `subscribe` and `usePushNotifications` hooks are called inside `BookmarkToastItem` (or whatever component owns `handleCta`) and add:

```ts
import { useAnonPush } from '@/hooks/useAnonPush'
import { useFollowing } from '@/hooks/useFollowing'
```

And inside the component body, alongside the existing hook calls:

```ts
const anonPush = useAnonPush()
const { getFollowed } = useFollowing()
```

- [ ] **Step 3: (Optional cleanup) Stop dispatching the legacy SIGNIN_PENDING toast**

There's a `usePostSigninPushPrompt()` hook that re-fires the enable-push toast on signin if `PUSH_SIGNIN_PENDING_KEY` was set. With anon push live, anonymous users get the prompt at the moment of their first follow — there's no need to re-prompt on signin.

For v1, leave the post-signin re-prompt logic in place — it's harmless because no callsite sets `PUSH_SIGNIN_PENDING_KEY` anymore. Cleanup of that hook + the localStorage key is a follow-up.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/BookmarkToast.tsx
git commit -m "$(cat <<'EOF'
feat(anon-push): BookmarkToast enable-push CTA registers anon sub directly

Anon users tapping "Enable alerts" no longer punt through a sign-in
sheet. With Spec 2 live, the toast calls anonPush.ensureSubscription
directly with the user's current bookmark set. Sign-in is still
encouraged later (LoginCtaSheet, WelcomeStrip) but is no longer a
prerequisite for receiving push.

The legacy PUSH_SIGNIN_PENDING_KEY + usePostSigninPushPrompt hook is
left in place — no callsite writes the key anymore so the post-signin
re-prompt is dormant. Cleanup is a follow-up.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Push sender — add anon recipient fan-out

**Why:** The existing `/api/push/notify` route fans out to authenticated users via a JOIN of `push_subscriptions` and `user_bookmarks`. Add a parallel anonymous fan-out via `anon_push_subscriptions` JOIN `anon_bookmarks` so anon devices get notified for the same matches.

**Files:**
- Modify: `src/app/api/push/notify/route.ts`

- [ ] **Step 1: Read the existing fan-out**

Run: `sed -n '250,350p' src/app/api/push/notify/route.ts`

Confirm the structure: `recipientReason` Map → fetch `push_subscriptions` for those user_ids → `Promise.allSettled` of `sendPush()` for each subscription.

- [ ] **Step 2: Add the anonymous fan-out after the user-side block**

Locate the section AFTER the existing user-recipient `Promise.allSettled` for sendPush (the one that loops `subsByUser`). Add a new parallel block that handles anonymous recipients. The cleanest split is to extract the existing user-side push-loop into one `await` and then run the anon-side push-loop after.

Insert this block (after the existing user-side push fan-out completes, before the final `return Response.json(...)`):

```ts
// ── Anonymous recipient fan-out ───────────────────────────
// Devices in anon_push_subscriptions whose anon_bookmarks reference
// the same match (bookmark) or any of the 4 player IDs (follow).
// Anonymous recipients have no profile → no per-channel prefs and
// no in-app notification row; we just send the push.
const { data: anonSubs } = await supabase
  .from('anon_push_subscriptions')
  .select('id, device_id, endpoint, p256dh_key, auth_key, anon_bookmarks!inner(bookmark_type, target_id)')
  // Inner join via the device_id FK relationship.
  // Filter at the SQL level so we only receive devices whose bookmarks
  // match this match's targets.
  .or(
    `and(anon_bookmarks.bookmark_type.eq.match,anon_bookmarks.target_id.eq.${matchId}),` +
    `and(anon_bookmarks.bookmark_type.eq.player,anon_bookmarks.target_id.in.(${playerIds.join(',')}))`,
  )

let anonSent = 0
let anonStaleIds: string[] = []
if (anonSubs && anonSubs.length > 0) {
  // Build a generic payload — we don't have a per-recipient reason
  // (that's a sign-in concept). Use the bookmark-style content for
  // both follow + bookmark cases since anon users have minimal
  // personalisation.
  const anonContent = isFinishedEvent
    ? buildFinishedContent(match, { kind: 'bookmark' }, null)
    : { title: t('liveTitle'), body: buildBody(match) }

  const anonResults = await Promise.allSettled(
    anonSubs.map(s =>
      sendPush(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh_key, auth: s.auth_key },
        },
        {
          title: anonContent.title,
          body: anonContent.body,
          url: `/match/${matchId}`,
          tag: `match-${matchId}`,
        },
      ),
    ),
  )
  anonSubs.forEach((s, i) => {
    const r = anonResults[i]
    if (r.status === 'fulfilled' && r.value === true) {
      anonSent++
    } else if (r.status === 'fulfilled' && r.value === false) {
      // sendPush returns false on 410/404 → stale subscription
      anonStaleIds.push(s.id as string)
    }
  })
}

// Delete stale anon subscriptions; trigger handles bookmark cleanup.
if (anonStaleIds.length > 0) {
  await supabase
    .from('anon_push_subscriptions')
    .delete()
    .in('id', anonStaleIds)
}

// Bump last_seen_at for surviving anon subs that successfully received
// a push — used by the 90-day cleanup cron.
const survivingAnonIds = (anonSubs ?? [])
  .filter(s => !anonStaleIds.includes(s.id as string))
  .map(s => s.id as string)
if (survivingAnonIds.length > 0) {
  await supabase
    .from('anon_push_subscriptions')
    .update({ last_seen_at: new Date().toISOString() })
    .in('id', survivingAnonIds)
}
```

**Important caveats / things to verify in this task:**

1. The `t('liveTitle')` call at the top of the new `anonContent` branch above expects the same translation function the existing route uses. If the existing code uses a different mechanism (server-side translations are awkward), check the existing live-event title generation in the route — there's already a similar live-title build path that doesn't go through the user's locale (anon users have no per-user locale preference, so a single shared title is fine). **Use whatever string the existing route uses for its bookmark-reason live title. Don't introduce a new translation key here.**

2. The `.or(...)` Supabase filter syntax for joined tables needs a sanity check — Supabase's PostgREST embedding can be finicky with disjunctions. If the embedded-OR doesn't work, fall back to two queries (one for `bookmark_type=match`, one for `bookmark_type=player IN playerIds`) and concat results in JS. Either way, the goal is "all anon devices whose bookmarks match this match's targets."

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Add a smoke test**

Manual test (locally on dev or in a staging run):
1. In one browser, accept push consent and follow a player (Galán).
2. In another (incognito) authenticated browser, do the same.
3. Hit `POST /api/push/notify { matchId }` for a match Galán is playing in.
4. Expected: both browsers receive the push.

If the second hit fails (anon doesn't receive), check the dev logs for the `.or(...)` query — most likely culprit.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/push/notify/route.ts'
git commit -m "$(cat <<'EOF'
feat(anon-push): notify route fans out to anon recipients

Adds a parallel anon-recipient query (anon_push_subscriptions JOIN
anon_bookmarks on device_id, filtered to the same match's targets)
after the existing user-recipient push loop. Anon recipients have
no profile/prefs/in-app notifications — the cron just sends the push.

410/404 from the push service triggers a DELETE on the anon row
(cascade trigger handles bookmarks cleanup). Successful deliveries
bump last_seen_at so the 90-day cleanup cron leaves active devices
alone.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Cleanup cron — delete inactive anon subs

**Why:** Devices that grant once and never return leave dead rows. A weekly cron deletes anon subscriptions whose `last_seen_at` is older than 90 days. The trigger handles the `anon_bookmarks` cascade.

**Files:**
- Create: `src/app/api/cron/anon-push-cleanup/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Write the cron route**

Create `src/app/api/cron/anon-push-cleanup/route.ts`:

```ts
// /api/cron/anon-push-cleanup
//
// Weekly cron — deletes anon_push_subscriptions rows whose
// last_seen_at is older than 90 days. The cascade trigger in the
// migration drops the device's anon_bookmarks rows automatically.
//
// Vercel cron schedule registered in vercel.json.

import { createClient } from '@supabase/supabase-js'
import { padelapiPausedResponse } from '@/lib/padelapi-pause'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export async function GET(req: Request) {
  // Cron-secret auth (matches the convention used by other Vercel crons).
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Honor the global padelapi pause flag — not because we touch padelapi
  // (we don't) but because the same flag often indicates a wider incident
  // window where housekeeping should pause too.
  const pause = padelapiPausedResponse('anon-push-cleanup')
  if (pause) return pause

  const cutoff = new Date(Date.now() - NINETY_DAYS_MS).toISOString()

  const { data, error } = await supabase
    .from('anon_push_subscriptions')
    .delete()
    .lt('last_seen_at', cutoff)
    .select('id')

  if (error) {
    console.error('[anon-push-cleanup] delete failed', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  return Response.json({
    ok: true,
    deleted: data?.length ?? 0,
    cutoff,
  })
}
```

- [ ] **Step 2: Register the cron in `vercel.json`**

Read the existing vercel.json:
```bash
cat vercel.json
```

Find the `crons` array. Add a new entry:

```json
{
  "path": "/api/cron/anon-push-cleanup",
  "schedule": "0 4 * * 1"
}
```

Mondays at 04:00 UTC — quiet time, doesn't collide with the existing crons (which run at :00 / :13 / :20 / :40 etc. on hourly cadences or specific weekdays).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/api/cron/anon-push-cleanup/route.ts' vercel.json
git commit -m "$(cat <<'EOF'
feat(anon-push): weekly cleanup cron

Deletes anon_push_subscriptions rows whose last_seen_at is older
than 90 days. Cascade trigger handles anon_bookmarks. Mondays
04:00 UTC. Honors the PADELAPI_PAUSED kill-switch as a wider
incident-window safety.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Final smoke + acceptance verification

**Why:** Walk through every acceptance criterion from the spec end-to-end before opening the PR.

**Files:** none modified — this is verification only.

- [ ] **Step 1: Apply the DB migration**

In the Supabase dashboard for the dev project:
1. Open SQL Editor.
2. Paste `supabase/migrations/20260506000001_anon_push_subscriptions.sql`.
3. Run it.
4. Verify the two tables + indexes + trigger exist:
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_name IN ('anon_push_subscriptions', 'anon_bookmarks');
   SELECT trigger_name FROM information_schema.triggers
   WHERE event_object_table = 'anon_push_subscriptions';
   ```

- [ ] **Step 2: Run all unit tests**

```bash
npx vitest run src/lib/__tests__/consent.test.ts src/lib/__tests__/anon-push.test.ts
```
Expected: all green.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 4: Manual end-to-end on Android Chrome (or desktop Chrome incognito)**

1. **Spec criterion: anon receives push.** Clear localStorage, accept cookie banner with push toggle ON, follow a player who has a live match coming up. Native browser push prompt fires; tap Allow. Trigger the push by hitting `POST /api/push/notify` for that match (admin tools or directly via curl with CRON_SECRET). Verify the Android notification appears.

2. **Spec criterion: subsequent toggles work.** With the device subscribed, follow another player. Verify `anon_bookmarks` table has a new row for the new player. Unfollow — verify the row disappears.

3. **Spec criterion: sign-in migration.** While anonymous with 2 followed players + an active subscription, sign in. Verify:
   - `push_subscriptions` has the user's row with the same endpoint
   - `anon_push_subscriptions` no longer has a row for this device_id
   - `anon_bookmarks` no longer has rows (cascade)
   - The user keeps receiving push (trigger another notify)

4. **Spec criterion: no consent → no registration.** Clear localStorage, reject push consent in the cookie banner, follow a player. Verify the native push prompt does NOT fire and no `anon_push_subscriptions` row is created.

5. **Spec criterion: 410 cleanup.** Manually delete the push subscription on the device side (DevTools → Application → Service Workers → Unsubscribe). Trigger another notify for that match. Verify the anon_push_subscriptions row is deleted automatically (the sender catches 410).

6. **Spec criterion: feature gracefully off on iOS Safari.** Open in iOS Safari (not installed as PWA). Banner accepts push consent. Follow a player. No errors in console; `anon_push_subscriptions` has no row (because `isPushSupported()` returned false).

If any check fails, debug + fix before the PR.

- [ ] **Step 5: No commit needed for this task — verification only.**

---

## Self-review (run before opening PR)

1. **Spec coverage:** All 10 acceptance criteria from the spec map to a task above:
   - Anon Android Chrome user receives push for followed player → Tasks 1, 3, 4, 6, 12 (verified in Task 14)
   - First-follow elsewhere triggers same registration → Task 8
   - Subsequent toggles update server-side → Tasks 4, 6, 8
   - Sign-in migrates without re-prompt → Tasks 5, 6, 9
   - Authenticated user keeps receiving after sign-in → Task 5
   - 410 deletes subscription + cascades bookmarks → Tasks 1, 12
   - Weekly cleanup deletes 90-day-inactive subs → Task 13
   - CHECK constraint allows future expansion → Task 1
   - All anon-push code is no-op when consent.push !== true → Tasks 2, 6, 7
   - iOS Safari users gracefully fall through → Task 2 (`isPushSupported` returns false)

2. **Final test pass:**
   ```bash
   npx vitest run src/lib/__tests__/anon-push.test.ts src/lib/__tests__/consent.test.ts
   npx tsc --noEmit
   npm run build
   ```
   All green = ready for PR.

3. **PR title suggestion:** `feat(anon-push): Web Push for anonymous users`
