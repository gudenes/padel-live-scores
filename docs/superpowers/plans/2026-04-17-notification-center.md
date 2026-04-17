# Notification Center + Granular Prefs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a durable in-app notification log, per-category/per-channel preferences, header bell, and `/notifications` + `/profile/settings/notifications` UI — while preserving today's push behavior for users on defaults.

**Architecture:** Writes land in a new `user_notifications` table keyed on the Auth.js `users` FK; preferences live as a JSONB column on `profiles` and merge with code-defined defaults via a pure resolver. The existing `/api/push/notify` endpoint is rewired to consult per-user prefs before choosing push, in-app, both, or neither channel. Four new REST endpoints (`GET /api/notifications`, `POST /api/notifications/mark-read`, `GET /api/notifications/unread-count`, `GET/PATCH /api/user/notification-prefs`) back a client-rendered page and a polling header bell.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · next-intl · Supabase · vitest

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260418_user_notifications.sql` | Creates `user_notifications` table + 2 indexes. |
| `supabase/migrations/20260418_profiles_notification_prefs.sql` | Adds `notification_prefs JSONB` column to `profiles`. |
| `src/lib/notification-categories.ts` | Source of truth for category list, defaults, `resolvePrefs`, `categoryFilter`. Pure module. |
| `src/lib/__tests__/notification-categories.test.ts` | Vitest coverage for `resolvePrefs` + `categoryFilter`. |
| `src/app/api/notifications/route.ts` | `GET` list current user's notifications (filter + cursor). |
| `src/app/api/notifications/mark-read/route.ts` | `POST` mark one/many/all notifications read. |
| `src/app/api/notifications/unread-count/route.ts` | `GET` bell badge count. |
| `src/app/api/user/notification-prefs/route.ts` | `GET` resolved prefs + `PATCH` to update one category/channel. |
| `src/app/api/notifications/__tests__/route.test.ts` | Integration tests for the four new routes (filter, cursor, isolation, prefs validation). |
| `src/app/api/push/notify/__tests__/route.test.ts` | Integration tests for the notify rewire (prefs fanout + independence of push vs in-app). |
| `src/components/NotificationBell.tsx` | Client bell icon for `AppHeader` with poll + event listener. |
| `src/components/NotificationRow.tsx` | Single row in `/notifications`: tile + title + body + timestamp + unread styling. |
| `src/app/[locale]/(app)/notifications/page.tsx` | Notification center page: sub-header, filter pills, day-grouped list, infinite scroll, mark-all-read. |
| `src/app/[locale]/(app)/profile/settings/notifications/page.tsx` | Granular prefs sub-page: master kill-switch + category toggle grid. |

### Modified files

| Path | Change |
|---|---|
| `src/app/api/push/notify/route.ts` | Rewire to consult `notification_prefs`, route per-user to push/in-app/both/neither, batch-insert in-app rows, preserve existing recipient map. |
| `src/components/AppHeader.tsx` | Insert `<NotificationBell />` between Share button and `<ProfileButton />`. |
| `src/app/[locale]/(app)/profile/settings/page.tsx` | Replace Phase 1 push toggle row with a navigation row linking to `/profile/settings/notifications`. |
| `src/messages/en.json` | Add `notifications` namespace + `settingsLinkRow` key. |
| `src/messages/es.json` | Translated `notifications` namespace. |
| `src/messages/pt.json` | Translated `notifications` namespace. |
| `src/messages/it.json` | Translated `notifications` namespace. |
| `src/messages/fr.json` | Translated `notifications` namespace. |

---

## Task 1: Migration — `user_notifications` table

**Files:**
- Create `supabase/migrations/20260418_user_notifications.sql`

- [ ] **Step 1: Create the migration file.**

  Write the following content to `supabase/migrations/20260418_user_notifications.sql`:

  ```sql
  -- User notifications: durable in-app log of events shown to a user.
  -- Written by the notify endpoint + future event triggers (match_finished,
  -- badge_earned, etc.). Read by the /notifications page and the header bell.
  -- Rows cascade-deleted when the Auth.js user is deleted.

  CREATE TABLE IF NOT EXISTS user_notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    url         TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
    ON user_notifications(user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
    ON user_notifications(user_id)
    WHERE read_at IS NULL;

  COMMENT ON TABLE user_notifications IS
    'Durable in-app notification log. One row per user per event. Retention target: 60 days (cleanup cron TBD).';
  COMMENT ON COLUMN user_notifications.category IS
    'Free-text category key; see src/lib/notification-categories.ts for valid values.';
  COMMENT ON COLUMN user_notifications.metadata IS
    'Category-specific extras (match_id, badge_id, reason, etc.). Shape depends on category.';
  ```

- [ ] **Step 2: Apply via Supabase dashboard.**

  Open the Supabase dashboard → SQL Editor → paste the file contents → Run.
  Expected: `Success. No rows returned`.
  Verify with:

  ```sql
  SELECT table_name FROM information_schema.tables WHERE table_name = 'user_notifications';
  ```

  Expected: one row with `user_notifications`.

**Commit:** `feat(migrations): add user_notifications table`

---

## Task 2: Migration — `profiles.notification_prefs` column

**Files:**
- Create `supabase/migrations/20260418_profiles_notification_prefs.sql`

- [ ] **Step 1: Create the migration file.**

  Write the following content to `supabase/migrations/20260418_profiles_notification_prefs.sql`:

  ```sql
  -- Per-user notification preferences: one JSONB keyed by category,
  -- each value is { push: bool, inApp: bool }. Missing keys fall back
  -- to defaults in src/lib/notification-categories.ts, so adding new
  -- categories requires no migration.

  ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

  COMMENT ON COLUMN profiles.notification_prefs IS
    'Per-category, per-channel notification prefs. Shape: { [category]: { push: bool, inApp: bool } }. Missing keys fall back to defaults defined in code.';
  ```

- [ ] **Step 2: Apply via Supabase dashboard.**

  Open the Supabase dashboard → SQL Editor → paste the file contents → Run.
  Expected: `Success. No rows returned`.
  Verify with:

  ```sql
  SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'notification_prefs';
  ```

  Expected: one row showing `jsonb` type and default `'{}'::jsonb`.

**Commit:** `feat(migrations): add profiles.notification_prefs column`

---

## Task 3: Categories module + defaults + resolver

**Files:**
- Create `src/lib/notification-categories.ts`

- [ ] **Step 1: Write the categories module.**

  Write the following to `src/lib/notification-categories.ts`:

  ```ts
  // src/lib/notification-categories.ts
  //
  // Single source of truth for notification categories. Used by:
  //   - /api/push/notify  (writer — resolves per-user prefs before fanout)
  //   - /api/notifications  (read/filter)
  //   - /api/user/notification-prefs  (validation + GET resolver)
  //   - /profile/settings/notifications  (UI render)
  //   - /notifications  (filter pill → category IN list)
  //
  // Adding a new category is a one-line change here — no migration needed.

  export type ChannelPrefs = { push: boolean; inApp: boolean }

  export type NotificationCategory =
    | 'match_live_follow'
    | 'match_live_bookmark'
    | 'match_finished'
    | 'match_upcoming'
    | 'badge_earned'
    | 'streak_milestone'
    | 'marketing'

  export const CATEGORY_DEFAULTS: Record<NotificationCategory, ChannelPrefs> = {
    match_live_follow:   { push: true,  inApp: true  },
    match_live_bookmark: { push: true,  inApp: true  },
    match_finished:      { push: false, inApp: true  },
    match_upcoming:      { push: false, inApp: true  },
    badge_earned:        { push: true,  inApp: true  },
    streak_milestone:    { push: true,  inApp: true  },
    marketing:           { push: false, inApp: false },
  }

  export const KNOWN_CATEGORIES = Object.keys(CATEGORY_DEFAULTS) as NotificationCategory[]

  export function isKnownCategory(value: unknown): value is NotificationCategory {
    return typeof value === 'string' && (KNOWN_CATEGORIES as string[]).includes(value)
  }

  /**
   * Merge a stored JSONB prefs object with the code defaults for a given
   * category. Missing keys (or entire missing category) fall back to
   * defaults; partial overrides ({ push: false }) keep the default inApp.
   *
   * stored is whatever came out of `profiles.notification_prefs` — may be
   * null, {}, or a partial object.
   */
  export function resolvePrefs(
    stored: Record<string, Partial<ChannelPrefs>> | null | undefined,
    category: NotificationCategory,
  ): ChannelPrefs {
    const defaults = CATEGORY_DEFAULTS[category]
    const override = stored?.[category]
    if (!override) return { ...defaults }
    return {
      push: typeof override.push === 'boolean' ? override.push : defaults.push,
      inApp: typeof override.inApp === 'boolean' ? override.inApp : defaults.inApp,
    }
  }

  /** Resolve the whole prefs object (every known category) at once. */
  export function resolveAllPrefs(
    stored: Record<string, Partial<ChannelPrefs>> | null | undefined,
  ): Record<NotificationCategory, ChannelPrefs> {
    const out = {} as Record<NotificationCategory, ChannelPrefs>
    for (const key of KNOWN_CATEGORIES) {
      out[key] = resolvePrefs(stored, key)
    }
    return out
  }

  /** Filter pill → list of categories. 'all' returns null (= no filter). */
  export function categoryFilter(
    filter: 'all' | 'matches' | 'badges' | string,
  ): NotificationCategory[] | null {
    switch (filter) {
      case 'all':
        return null
      case 'matches':
        return ['match_live_follow', 'match_live_bookmark', 'match_finished', 'match_upcoming']
      case 'badges':
        return ['badge_earned', 'streak_milestone']
      default:
        return []
    }
  }
  ```

**Commit:** `feat(notifications): add category defaults + resolvePrefs module`

---

## Task 4: Test `resolvePrefs` and `categoryFilter`

**Files:**
- Create `src/lib/__tests__/notification-categories.test.ts`

- [ ] **Step 1: Write the test file.**

  Write the following to `src/lib/__tests__/notification-categories.test.ts`:

  ```ts
  /**
   * notification-categories.test.ts
   *
   * Unit tests for the pure defaults/resolver/filter module.
   * Run with: npx vitest run src/lib/__tests__/notification-categories.test.ts
   */

  import { describe, it, expect } from 'vitest'
  import {
    CATEGORY_DEFAULTS,
    KNOWN_CATEGORIES,
    isKnownCategory,
    resolvePrefs,
    resolveAllPrefs,
    categoryFilter,
  } from '../notification-categories'

  describe('CATEGORY_DEFAULTS', () => {
    it('contains exactly 7 categories', () => {
      expect(KNOWN_CATEGORIES).toHaveLength(7)
    })

    it('marketing defaults to off for both channels', () => {
      expect(CATEGORY_DEFAULTS.marketing).toEqual({ push: false, inApp: false })
    })

    it('match_live_* defaults to on for both channels', () => {
      expect(CATEGORY_DEFAULTS.match_live_follow).toEqual({ push: true, inApp: true })
      expect(CATEGORY_DEFAULTS.match_live_bookmark).toEqual({ push: true, inApp: true })
    })

    it('match_finished and match_upcoming default push off, inApp on', () => {
      expect(CATEGORY_DEFAULTS.match_finished).toEqual({ push: false, inApp: true })
      expect(CATEGORY_DEFAULTS.match_upcoming).toEqual({ push: false, inApp: true })
    })
  })

  describe('isKnownCategory', () => {
    it('returns true for each known category', () => {
      for (const k of KNOWN_CATEGORIES) expect(isKnownCategory(k)).toBe(true)
    })

    it('returns false for unknown strings', () => {
      expect(isKnownCategory('foo')).toBe(false)
      expect(isKnownCategory('')).toBe(false)
    })

    it('returns false for non-strings', () => {
      expect(isKnownCategory(null)).toBe(false)
      expect(isKnownCategory(undefined)).toBe(false)
      expect(isKnownCategory(42)).toBe(false)
    })
  })

  describe('resolvePrefs', () => {
    it('returns defaults when stored is null', () => {
      expect(resolvePrefs(null, 'match_live_follow')).toEqual({ push: true, inApp: true })
    })

    it('returns defaults when stored is undefined', () => {
      expect(resolvePrefs(undefined, 'marketing')).toEqual({ push: false, inApp: false })
    })

    it('returns defaults when stored is empty', () => {
      expect(resolvePrefs({}, 'match_live_bookmark')).toEqual({ push: true, inApp: true })
    })

    it('returns defaults when the category key is missing', () => {
      expect(resolvePrefs({ marketing: { push: true, inApp: true } }, 'match_finished'))
        .toEqual({ push: false, inApp: true })
    })

    it('uses stored override when both channels set', () => {
      expect(resolvePrefs({ match_live_follow: { push: false, inApp: false } }, 'match_live_follow'))
        .toEqual({ push: false, inApp: false })
    })

    it('merges partial override (push only) with default inApp', () => {
      expect(resolvePrefs({ match_live_follow: { push: false } }, 'match_live_follow'))
        .toEqual({ push: false, inApp: true })
    })

    it('merges partial override (inApp only) with default push', () => {
      expect(resolvePrefs({ badge_earned: { inApp: false } }, 'badge_earned'))
        .toEqual({ push: true, inApp: false })
    })

    it('ignores non-boolean junk in override', () => {
      const junk = { match_live_follow: { push: 'yes' as unknown as boolean } }
      expect(resolvePrefs(junk, 'match_live_follow')).toEqual({ push: true, inApp: true })
    })
  })

  describe('resolveAllPrefs', () => {
    it('returns all 7 categories', () => {
      const all = resolveAllPrefs(null)
      expect(Object.keys(all)).toHaveLength(7)
      expect(all.match_live_follow).toEqual({ push: true, inApp: true })
      expect(all.marketing).toEqual({ push: false, inApp: false })
    })

    it('applies overrides per category', () => {
      const stored = { marketing: { push: true, inApp: true } }
      const all = resolveAllPrefs(stored)
      expect(all.marketing).toEqual({ push: true, inApp: true })
      expect(all.match_live_follow).toEqual({ push: true, inApp: true })
    })
  })

  describe('categoryFilter', () => {
    it('returns null for "all" (no filter)', () => {
      expect(categoryFilter('all')).toBeNull()
    })

    it('returns the 4 match categories for "matches"', () => {
      expect(categoryFilter('matches')).toEqual([
        'match_live_follow',
        'match_live_bookmark',
        'match_finished',
        'match_upcoming',
      ])
    })

    it('returns the 2 badge categories for "badges"', () => {
      expect(categoryFilter('badges')).toEqual(['badge_earned', 'streak_milestone'])
    })

    it('returns empty list for unknown filter', () => {
      expect(categoryFilter('zzz')).toEqual([])
    })
  })
  ```

- [ ] **Step 2: Run the test and confirm pass.**

  ```bash
  npx vitest run src/lib/__tests__/notification-categories.test.ts
  ```

  Expected output: `Test Files  1 passed (1)` with all tests green.

**Commit:** `test(notifications): resolvePrefs + categoryFilter coverage`

---

## Task 5: `GET /api/notifications` — list endpoint

**Files:**
- Create `src/app/api/notifications/route.ts`

- [ ] **Step 1: Write the route.**

  Write the following to `src/app/api/notifications/route.ts`:

  ```ts
  // src/app/api/notifications/route.ts
  // GET current user's notifications, newest first. Supports:
  //   - ?limit=30      (clamped server-side to 1..100)
  //   - ?before=ISO    (cursor — returns created_at < before)
  //   - ?filter=all|matches|badges
  //
  // Returns: { items: NotificationRow[], nextCursor: string | null }
  //   nextCursor is the created_at of the last row, null when fewer than
  //   `limit` rows returned (i.e. no more pages).

  import { getUserOrFail } from '../user/_auth'
  import { categoryFilter } from '@/lib/notification-categories'

  export async function GET(request: Request) {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    const url = new URL(request.url)
    const rawLimit = Number(url.searchParams.get('limit') ?? '30')
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 30, 1), 100)
    const before = url.searchParams.get('before')
    const filter = url.searchParams.get('filter') ?? 'all'

    let query = supabase
      .from('user_notifications')
      .select('id, category, title, body, url, metadata, read_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (before) query = query.lt('created_at', before)

    const cats = categoryFilter(filter)
    if (cats !== null) {
      if (cats.length === 0) {
        return Response.json({ items: [], nextCursor: null })
      }
      query = query.in('category', cats)
    }

    const { data, error: dbErr } = await query
    if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

    const items = data ?? []
    const nextCursor = items.length === limit ? items[items.length - 1].created_at : null

    return Response.json({ items, nextCursor })
  }
  ```

**Commit:** `feat(api): GET /api/notifications list endpoint`

---

## Task 6: `POST /api/notifications/mark-read` — mark one/all read

**Files:**
- Create `src/app/api/notifications/mark-read/route.ts`

- [ ] **Step 1: Write the route.**

  Write the following to `src/app/api/notifications/mark-read/route.ts`:

  ```ts
  // src/app/api/notifications/mark-read/route.ts
  // Body: { ids: string[] } | { all: true }
  // Only updates rows belonging to the current user that are still unread,
  // so it's safe to retry.
  // Response: { updated: number }

  import { getUserOrFail } from '../../user/_auth'

  export async function POST(request: Request) {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    const body = await request.json().catch(() => null) as
      | { ids?: unknown; all?: unknown }
      | null
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

    const now = new Date().toISOString()

    let query = supabase
      .from('user_notifications')
      .update({ read_at: now }, { count: 'exact' })
      .eq('user_id', user.id)
      .is('read_at', null)

    if (body.all === true) {
      // no extra filter — mark every unread row
    } else if (Array.isArray(body.ids) && body.ids.every((x): x is string => typeof x === 'string')) {
      if (body.ids.length === 0) return Response.json({ updated: 0 })
      query = query.in('id', body.ids)
    } else {
      return Response.json({ error: 'Expected { ids: string[] } or { all: true }' }, { status: 400 })
    }

    const { count, error: dbErr } = await query
    if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

    return Response.json({ updated: count ?? 0 })
  }
  ```

**Commit:** `feat(api): POST /api/notifications/mark-read`

---

## Task 7: `GET /api/notifications/unread-count` — bell badge

**Files:**
- Create `src/app/api/notifications/unread-count/route.ts`

- [ ] **Step 1: Write the route.**

  Write the following to `src/app/api/notifications/unread-count/route.ts`:

  ```ts
  // src/app/api/notifications/unread-count/route.ts
  // GET raw unread count for the current user. UI clamps to "99+".
  // Uses the partial index on (user_id) WHERE read_at IS NULL for cheap counts.

  import { getUserOrFail } from '../../user/_auth'

  export async function GET() {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    const { count, error: dbErr } = await supabase
      .from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null)

    if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

    return Response.json({ count: count ?? 0 })
  }
  ```

**Commit:** `feat(api): GET /api/notifications/unread-count`

---

## Task 8: `GET`/`PATCH /api/user/notification-prefs`

**Files:**
- Create `src/app/api/user/notification-prefs/route.ts`

- [ ] **Step 1: Write the route.**

  Write the following to `src/app/api/user/notification-prefs/route.ts`:

  ```ts
  // src/app/api/user/notification-prefs/route.ts
  // GET    → { prefs: Record<category, { push, inApp }> }  (resolved with defaults)
  // PATCH  body: { category, push?, inApp? }
  //        → { ok: true, prefs: <resolved> }

  import { getUserOrFail } from '../_auth'
  import {
    isKnownCategory,
    resolveAllPrefs,
    type ChannelPrefs,
    type NotificationCategory,
  } from '@/lib/notification-categories'

  export async function GET() {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    const { data, error: dbErr } = await supabase
      .from('profiles')
      .select('notification_prefs')
      .eq('id', user.id)
      .maybeSingle()

    if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

    const stored = (data?.notification_prefs ?? null) as
      | Record<string, Partial<ChannelPrefs>>
      | null
    return Response.json({ prefs: resolveAllPrefs(stored) })
  }

  export async function PATCH(request: Request) {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    const body = await request.json().catch(() => null) as
      | { category?: unknown; push?: unknown; inApp?: unknown }
      | null
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

    if (!isKnownCategory(body.category)) {
      return Response.json({ error: 'Unknown category' }, { status: 400 })
    }
    const category = body.category as NotificationCategory

    const hasPush = typeof body.push === 'boolean'
    const hasInApp = typeof body.inApp === 'boolean'
    if (!hasPush && !hasInApp) {
      return Response.json({ error: 'Expected push and/or inApp boolean' }, { status: 400 })
    }

    // Read-modify-write the JSONB. Concurrent writes for the same user are
    // extremely unlikely; last-write-wins is acceptable.
    const { data: row, error: readErr } = await supabase
      .from('profiles')
      .select('notification_prefs')
      .eq('id', user.id)
      .maybeSingle()
    if (readErr) return Response.json({ error: readErr.message }, { status: 500 })

    const current = (row?.notification_prefs ?? {}) as
      Record<string, Partial<ChannelPrefs>>
    const nextCategory = { ...(current[category] ?? {}) }
    if (hasPush) nextCategory.push = body.push as boolean
    if (hasInApp) nextCategory.inApp = body.inApp as boolean
    const next = { ...current, [category]: nextCategory }

    const { error: writeErr } = await supabase
      .from('profiles')
      .update({ notification_prefs: next })
      .eq('id', user.id)
    if (writeErr) return Response.json({ error: writeErr.message }, { status: 500 })

    return Response.json({ ok: true, prefs: resolveAllPrefs(next) })
  }
  ```

**Commit:** `feat(api): GET/PATCH /api/user/notification-prefs`

---

## Task 9: Integration tests for the four new endpoints

**Files:**
- Create `src/app/api/notifications/__tests__/route.test.ts`

- [ ] **Step 1: Write the integration test file.**

  Write the following to `src/app/api/notifications/__tests__/route.test.ts`:

  ```ts
  /**
   * route.test.ts — notifications + prefs endpoints
   *
   * Integration tests using Supabase service client against the live DB
   * (same pattern as other existing api-route tests in the repo).
   * Run with: npx vitest run src/app/api/notifications/__tests__/route.test.ts
   *
   * Each test creates two ephemeral users, exercises the endpoint via its
   * exported handler, and asserts isolation + shape.
   */

  import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
  import { createClient } from '@supabase/supabase-js'

  // Patch getUserOrFail to inject a fake session for each test.
  let CURRENT_USER_ID: string | null = null
  vi.mock('@/app/api/user/_auth', () => ({
    getUserOrFail: async () => {
      if (!CURRENT_USER_ID) return { user: null, supabase: null, error: Response.json({ error: 'unauthorized' }, { status: 401 }) }
      return {
        user: { id: CURRENT_USER_ID },
        supabase: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!),
        error: null,
      }
    },
  }))

  import { GET as listGet } from '../route'
  import { POST as markReadPost } from '../mark-read/route'
  import { GET as unreadCountGet } from '../unread-count/route'
  import { GET as prefsGet, PATCH as prefsPatch } from '../../user/notification-prefs/route'

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

  let userA = ''
  let userB = ''

  beforeAll(async () => {
    const a = await svc.from('users').insert({ email: `notif-a-${Date.now()}@test.local` }).select('id').single()
    const b = await svc.from('users').insert({ email: `notif-b-${Date.now()}@test.local` }).select('id').single()
    userA = a.data!.id as string
    userB = b.data!.id as string
    await svc.from('profiles').insert([{ id: userA }, { id: userB }])

    // Seed 3 notifications for A, 1 for B
    const now = Date.now()
    await svc.from('user_notifications').insert([
      { user_id: userA, category: 'match_live_follow', title: 'A-1', created_at: new Date(now - 3000).toISOString() },
      { user_id: userA, category: 'badge_earned',     title: 'A-2', created_at: new Date(now - 2000).toISOString() },
      { user_id: userA, category: 'marketing',        title: 'A-3', created_at: new Date(now - 1000).toISOString() },
      { user_id: userB, category: 'match_live_follow', title: 'B-1', created_at: new Date(now - 1500).toISOString() },
    ])
  })

  afterAll(async () => {
    await svc.from('users').delete().in('id', [userA, userB])
  })

  describe('GET /api/notifications', () => {
    it('returns 401 when not authenticated', async () => {
      CURRENT_USER_ID = null
      const res = await listGet(new Request('http://x/api/notifications'))
      expect(res.status).toBe(401)
    })

    it('returns only the current user’s rows sorted DESC', async () => {
      CURRENT_USER_ID = userA
      const res = await listGet(new Request('http://x/api/notifications'))
      const body = await res.json() as { items: Array<{ title: string }> }
      expect(body.items.map(i => i.title)).toEqual(['A-3', 'A-2', 'A-1'])
    })

    it('filter=matches narrows to match_live_follow', async () => {
      CURRENT_USER_ID = userA
      const res = await listGet(new Request('http://x/api/notifications?filter=matches'))
      const body = await res.json() as { items: Array<{ category: string }> }
      expect(body.items.every(i => i.category === 'match_live_follow')).toBe(true)
      expect(body.items).toHaveLength(1)
    })

    it('filter=badges narrows to badge_earned', async () => {
      CURRENT_USER_ID = userA
      const res = await listGet(new Request('http://x/api/notifications?filter=badges'))
      const body = await res.json() as { items: Array<{ category: string }> }
      expect(body.items.map(i => i.category)).toEqual(['badge_earned'])
    })

    it('limit=1 returns at most one + sets nextCursor', async () => {
      CURRENT_USER_ID = userA
      const res = await listGet(new Request('http://x/api/notifications?limit=1'))
      const body = await res.json() as { items: unknown[]; nextCursor: string | null }
      expect(body.items).toHaveLength(1)
      expect(body.nextCursor).toBeTruthy()
    })

    it('before=cursor returns older rows', async () => {
      CURRENT_USER_ID = userA
      const first = await listGet(new Request('http://x/api/notifications?limit=1'))
      const { nextCursor } = await first.json() as { nextCursor: string }
      const res = await listGet(new Request(`http://x/api/notifications?limit=1&before=${encodeURIComponent(nextCursor)}`))
      const body = await res.json() as { items: Array<{ title: string }> }
      expect(body.items[0].title).toBe('A-2')
    })
  })

  describe('GET /api/notifications/unread-count', () => {
    it('counts unread rows for the current user only', async () => {
      CURRENT_USER_ID = userA
      const res = await unreadCountGet()
      const body = await res.json() as { count: number }
      expect(body.count).toBe(3)
    })

    it('cross-user isolation — userB sees only their own', async () => {
      CURRENT_USER_ID = userB
      const res = await unreadCountGet()
      const body = await res.json() as { count: number }
      expect(body.count).toBe(1)
    })
  })

  describe('POST /api/notifications/mark-read', () => {
    it('rejects invalid body', async () => {
      CURRENT_USER_ID = userA
      const res = await markReadPost(new Request('http://x', { method: 'POST', body: JSON.stringify({}) }))
      expect(res.status).toBe(400)
    })

    it('marks a specific id read', async () => {
      CURRENT_USER_ID = userA
      const { data: row } = await svc.from('user_notifications').select('id').eq('user_id', userA).limit(1).single()
      const res = await markReadPost(new Request('http://x', { method: 'POST', body: JSON.stringify({ ids: [row!.id] }) }))
      const body = await res.json() as { updated: number }
      expect(body.updated).toBe(1)
      // Idempotent — re-run updates 0
      const again = await markReadPost(new Request('http://x', { method: 'POST', body: JSON.stringify({ ids: [row!.id] }) }))
      const b2 = await again.json() as { updated: number }
      expect(b2.updated).toBe(0)
    })

    it('{ all: true } marks remaining rows read', async () => {
      CURRENT_USER_ID = userA
      const res = await markReadPost(new Request('http://x', { method: 'POST', body: JSON.stringify({ all: true }) }))
      const body = await res.json() as { updated: number }
      expect(body.updated).toBeGreaterThanOrEqual(1)
      const countRes = await unreadCountGet()
      const c = await countRes.json() as { count: number }
      expect(c.count).toBe(0)
    })

    it('cannot mark another user’s rows read', async () => {
      CURRENT_USER_ID = userA
      const { data: bRow } = await svc.from('user_notifications').select('id').eq('user_id', userB).limit(1).single()
      const res = await markReadPost(new Request('http://x', { method: 'POST', body: JSON.stringify({ ids: [bRow!.id] }) }))
      const body = await res.json() as { updated: number }
      expect(body.updated).toBe(0)
    })
  })

  describe('GET/PATCH /api/user/notification-prefs', () => {
    it('GET returns resolved defaults for a fresh user', async () => {
      CURRENT_USER_ID = userB
      const res = await prefsGet()
      const body = await res.json() as { prefs: Record<string, { push: boolean; inApp: boolean }> }
      expect(body.prefs.marketing).toEqual({ push: false, inApp: false })
      expect(body.prefs.match_live_follow).toEqual({ push: true, inApp: true })
    })

    it('PATCH rejects unknown category', async () => {
      CURRENT_USER_ID = userB
      const res = await prefsPatch(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ category: 'foo', push: true }) }))
      expect(res.status).toBe(400)
    })

    it('PATCH rejects empty body', async () => {
      CURRENT_USER_ID = userB
      const res = await prefsPatch(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ category: 'marketing' }) }))
      expect(res.status).toBe(400)
    })

    it('PATCH merges a partial update and returns resolved prefs', async () => {
      CURRENT_USER_ID = userB
      const res = await prefsPatch(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ category: 'match_live_follow', push: false }) }))
      const body = await res.json() as { ok: boolean; prefs: Record<string, { push: boolean; inApp: boolean }> }
      expect(body.ok).toBe(true)
      expect(body.prefs.match_live_follow).toEqual({ push: false, inApp: true })
    })
  })
  ```

- [ ] **Step 2: Run the test and confirm pass.**

  ```bash
  npx vitest run src/app/api/notifications/__tests__/route.test.ts
  ```

  Expected output: `Test Files  1 passed (1)` with all tests green. (Requires local `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_KEY` and the two migrations applied.)

**Commit:** `test(api): notifications + prefs endpoint integration tests`

---

## Task 10: Rewire `/api/push/notify` to honor prefs + write in-app rows

**Files:**
- Modify `src/app/api/push/notify/route.ts`

- [ ] **Step 1: Replace the body of the POST handler with the new flow.**

  Replace the entire contents of `src/app/api/push/notify/route.ts` with:

  ```ts
  // src/app/api/push/notify/route.ts
  //
  // Internal endpoint — fired by the score cron when a match goes live.
  // Protected by CRON_SECRET. Same request shape as before: { matchId }.
  //
  // RECIPIENT FAN-OUT (unchanged from the pre-rewire version):
  //   1. Users who BOOKMARKED the match       → reason 'bookmark'
  //   2. Users who FOLLOW any of the 4 players → reason 'follow'
  //   When a user is in both groups, the follow reason wins (more specific).
  //
  // NEW: per-user prefs gate each channel:
  //   - category = reason.kind === 'follow' ? 'match_live_follow' : 'match_live_bookmark'
  //   - resolvePrefs(userPrefs, category) → { push, inApp }
  //   - push  flag gates the existing sendPush() call
  //   - inApp flag gates a row insert into user_notifications
  //   - Both branches run independently via Promise.allSettled — a failure
  //     in one does not prevent the other.

  import { createClient } from '@supabase/supabase-js'
  import { sendPush } from '@/lib/push'
  import { resolvePrefs, type ChannelPrefs } from '@/lib/notification-categories'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )

  interface PlayerLite { id: string; name: string | null }
  interface MatchRow {
    id: string
    round: string | null
    pair1_player1_id: string | null
    pair1_player2_id: string | null
    pair2_player1_id: string | null
    pair2_player2_id: string | null
    tournament: { name: string | null } | null
    pair1_player1: PlayerLite | null
    pair1_player2: PlayerLite | null
    pair2_player1: PlayerLite | null
    pair2_player2: PlayerLite | null
  }

  function lastName(fullName: string | null | undefined): string {
    if (!fullName) return ''
    const parts = fullName.trim().split(/\s+/)
    return parts[parts.length - 1] ?? ''
  }

  function buildBody(m: MatchRow): string {
    const lastNames = (a: PlayerLite | null, b: PlayerLite | null) =>
      [a?.name, b?.name].filter(Boolean).map(n => lastName(n)).join('/')
    const team1 = lastNames(m.pair1_player1, m.pair1_player2)
    const team2 = lastNames(m.pair2_player1, m.pair2_player2)
    const tournament = m.tournament?.name ?? ''
    const round = m.round ?? ''
    return `${team1} vs ${team2}${tournament ? ` — ${tournament}` : ''}${round ? ` ${round}` : ''}`
  }

  interface RecipientReason {
    kind: 'bookmark' | 'follow'
    followedPlayerName?: string
  }

  export async function POST(request: Request) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { matchId } = await request.json()
    if (!matchId) {
      return Response.json({ error: 'Missing matchId' }, { status: 400 })
    }

    // ── Fetch match details ────────────────────────────────────
    const { data: matchRaw } = await supabase
      .from('matches')
      .select(`
        id, round,
        pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
        tournament:tournaments(name),
        pair1_player1:players!matches_pair1_player1_id_fkey(id, name),
        pair1_player2:players!matches_pair1_player2_id_fkey(id, name),
        pair2_player1:players!matches_pair2_player1_id_fkey(id, name),
        pair2_player2:players!matches_pair2_player2_id_fkey(id, name)
      `)
      .eq('id', matchId)
      .single()

    if (!matchRaw) {
      return Response.json({ error: 'Match not found' }, { status: 404 })
    }
    const match = matchRaw as unknown as MatchRow

    // ── Build recipient → reason map ───────────────────────────
    const recipientReason = new Map<string, RecipientReason>()

    const { data: bookmarks } = await supabase
      .from('user_bookmarks')
      .select('user_id')
      .eq('bookmark_type', 'match')
      .eq('target_id', matchId)

    for (const b of bookmarks ?? []) {
      if (b.user_id) recipientReason.set(b.user_id as string, { kind: 'bookmark' })
    }

    const playerIds = [
      match.pair1_player1_id, match.pair1_player2_id,
      match.pair2_player1_id, match.pair2_player2_id,
    ].filter((id): id is string => !!id)

    const playerNameById = new Map<string, string>()
    for (const p of [match.pair1_player1, match.pair1_player2, match.pair2_player1, match.pair2_player2]) {
      if (p?.id && p.name) playerNameById.set(p.id, lastName(p.name))
    }

    if (playerIds.length > 0) {
      const { data: playerFollows } = await supabase
        .from('user_bookmarks')
        .select('user_id, target_id')
        .eq('bookmark_type', 'player')
        .in('target_id', playerIds)
      for (const f of playerFollows ?? []) {
        const userId = f.user_id as string | null
        const playerId = f.target_id as string | null
        if (!userId || !playerId) continue
        const existing = recipientReason.get(userId)
        if (existing?.kind === 'follow') continue
        const playerDisplayName = playerNameById.get(playerId)
        if (!playerDisplayName) continue
        recipientReason.set(userId, { kind: 'follow', followedPlayerName: playerDisplayName })
      }
    }

    if (recipientReason.size === 0) {
      return Response.json({ ok: true, recipients: 0, sent: 0, inapp_written: 0, reason: 'no recipients' })
    }

    const userIds = [...recipientReason.keys()]

    // ── Batch-fetch prefs + subscriptions in parallel ──────────
    const [prefsRes, subsRes] = await Promise.all([
      supabase.from('profiles').select('id, notification_prefs').in('id', userIds),
      supabase.from('push_subscriptions').select('id, user_id, endpoint, keys').in('user_id', userIds),
    ])

    const prefsByUser = new Map<string, Record<string, Partial<ChannelPrefs>>>()
    for (const row of prefsRes.data ?? []) {
      prefsByUser.set(
        row.id as string,
        (row.notification_prefs ?? {}) as Record<string, Partial<ChannelPrefs>>,
      )
    }

    const subsByUser = new Map<string, typeof subsRes.data>()
    for (const sub of subsRes.data ?? []) {
      const uid = sub.user_id as string
      const list = subsByUser.get(uid) ?? []
      list.push(sub)
      subsByUser.set(uid, list)
    }

    // ── Per-recipient resolve → split into in-app inserts + push payloads ──
    const body = buildBody(match)
    const inAppRows: Array<{
      user_id: string
      category: string
      title: string
      body: string
      url: string
      metadata: Record<string, unknown>
    }> = []
    type PushJob = { sub: { id: string; endpoint: string; keys: unknown }; title: string; body: string; url: string; tag: string }
    const pushJobs: PushJob[] = []

    for (const [userId, reason] of recipientReason) {
      const category = reason.kind === 'follow' ? 'match_live_follow' : 'match_live_bookmark'
      const resolved = resolvePrefs(prefsByUser.get(userId), category)
      const title = reason.kind === 'follow' && reason.followedPlayerName
        ? `${reason.followedPlayerName} is on court! 🟢`
        : 'Match is Live! 🟢'

      if (resolved.inApp) {
        inAppRows.push({
          user_id: userId,
          category,
          title,
          body,
          url: `/match/${matchId}`,
          metadata: {
            match_id: matchId,
            reason: reason.kind,
            ...(reason.followedPlayerName ? { followed_player_name: reason.followedPlayerName } : {}),
          },
        })
      }

      if (resolved.push) {
        const subs = subsByUser.get(userId) ?? []
        for (const sub of subs) {
          pushJobs.push({
            sub: { id: sub.id as string, endpoint: sub.endpoint as string, keys: sub.keys },
            title,
            body,
            url: `/match/${matchId}`,
            tag: `match-${matchId}`,
          })
        }
      }
    }

    // ── Independent delivery: in-app insert + push send, both allSettled ──
    let inappWritten = 0
    let pushSent = 0
    let bookmarkSent = 0
    let followSent = 0
    const staleIds: string[] = []

    await Promise.allSettled([
      (async () => {
        if (inAppRows.length === 0) return
        const { error: insErr, count } = await supabase
          .from('user_notifications')
          .insert(inAppRows, { count: 'exact' })
        if (insErr) {
          console.error('[Push] in-app insert failed:', insErr.message)
        } else {
          inappWritten = count ?? inAppRows.length
        }
      })(),
      (async () => {
        await Promise.allSettled(
          pushJobs.map(async (job) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const success = await sendPush({ endpoint: job.sub.endpoint, keys: job.sub.keys as any }, {
              title: job.title, body: job.body, url: job.url, tag: job.tag,
            })
            if (success) {
              pushSent++
              const reason = recipientReason.get(
                // Look up reason from userId via the sub — subsByUser keyed by user_id
                [...subsByUser.entries()].find(([, subs]) => subs.some(s => s.id === job.sub.id))?.[0] ?? '',
              )
              if (reason?.kind === 'follow') followSent++
              else bookmarkSent++
            } else {
              staleIds.push(job.sub.id)
            }
          })
        )
      })(),
    ])

    if (staleIds.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', staleIds)
      console.log(`[Push] Cleaned ${staleIds.length} stale subscriptions`)
    }

    console.log(
      `[Push] match=${matchId} recipients=${recipientReason.size} ` +
      `inapp=${inappWritten} push=${pushSent} ` +
      `(bookmark=${bookmarkSent} follow=${followSent}) stale=${staleIds.length}`
    )

    return Response.json({
      ok: true,
      recipients: recipientReason.size,
      inapp_written: inappWritten,
      sent: pushSent,
      by_reason: { bookmark: bookmarkSent, follow: followSent },
      stale_cleaned: staleIds.length,
    })
  }
  ```

- [ ] **Step 2: Run lint and confirm the file compiles.**

  ```bash
  npm run lint -- --max-warnings 0
  ```

  Expected: `✔ No ESLint warnings or errors`.

**Commit:** `refactor(push): notify routes through notification_prefs + writes in-app rows`

---

## Task 11: Integration tests for the rewired `/api/push/notify`

**Files:**
- Create `src/app/api/push/notify/__tests__/route.test.ts`

- [ ] **Step 1: Write the integration test.**

  Write the following to `src/app/api/push/notify/__tests__/route.test.ts`:

  ```ts
  /**
   * route.test.ts — /api/push/notify rewire
   *
   * Verifies per-user prefs routing + independence of push/in-app.
   * Runs against the real DB; stubs sendPush via vi.mock.
   * Run with: npx vitest run src/app/api/push/notify/__tests__/route.test.ts
   */

  import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
  import { createClient } from '@supabase/supabase-js'

  const sendPushMock = vi.fn(async () => true)
  vi.mock('@/lib/push', () => ({ sendPush: sendPushMock }))

  import { POST } from '../../route'

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

  const SECRET = process.env.CRON_SECRET ?? 'test-secret'

  let userId = ''
  let matchId = ''
  let playerId = ''
  let tournamentId = ''
  let subId = ''

  function authed(body: object) {
    return new Request('http://x/api/push/notify', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  beforeAll(async () => {
    process.env.CRON_SECRET = SECRET

    const u = await svc.from('users').insert({ email: `notify-${Date.now()}@test.local` }).select('id').single()
    userId = u.data!.id as string
    await svc.from('profiles').insert({ id: userId })

    const t = await svc.from('tournaments').insert({ name: 'Test Cup', padelapi_id: `test-${Date.now()}` }).select('id').single()
    tournamentId = t.data!.id as string

    const p = await svc.from('players').insert({ name: 'Ada Test', padelapi_id: `p-${Date.now()}` }).select('id').single()
    playerId = p.data!.id as string

    const m = await svc.from('matches').insert({
      tournament_id: tournamentId,
      pair1_player1_id: playerId,
      round: 'R32',
      padelapi_id: `m-${Date.now()}`,
    }).select('id').single()
    matchId = m.data!.id as string

    await svc.from('user_bookmarks').insert({ user_id: userId, bookmark_type: 'match', target_id: matchId })

    const s = await svc.from('push_subscriptions').insert({
      user_id: userId,
      endpoint: `https://test.example/${Date.now()}`,
      keys: { p256dh: 'x', auth: 'y' },
    }).select('id').single()
    subId = s.data!.id as string
  })

  afterAll(async () => {
    await svc.from('push_subscriptions').delete().eq('id', subId)
    await svc.from('user_bookmarks').delete().eq('user_id', userId)
    await svc.from('matches').delete().eq('id', matchId)
    await svc.from('players').delete().eq('id', playerId)
    await svc.from('tournaments').delete().eq('id', tournamentId)
    await svc.from('users').delete().eq('id', userId)
  })

  beforeEach(async () => {
    sendPushMock.mockClear()
    sendPushMock.mockImplementation(async () => true)
    await svc.from('user_notifications').delete().eq('user_id', userId)
    await svc.from('profiles').update({ notification_prefs: {} }).eq('id', userId)
  })

  describe('/api/push/notify rewire', () => {
    it('baseline — empty prefs → push + in-app row', async () => {
      const res = await POST(authed({ matchId }))
      const body = await res.json() as { sent: number; inapp_written: number }
      expect(body.sent).toBe(1)
      expect(body.inapp_written).toBe(1)
      expect(sendPushMock).toHaveBeenCalledTimes(1)

      const { data: rows } = await svc.from('user_notifications').select('*').eq('user_id', userId)
      expect(rows).toHaveLength(1)
      expect(rows![0].category).toBe('match_live_bookmark')
      expect(rows![0].url).toBe(`/match/${matchId}`)
    })

    it('push:false, inApp:true → no push, one in-app row', async () => {
      await svc.from('profiles').update({
        notification_prefs: { match_live_bookmark: { push: false, inApp: true } },
      }).eq('id', userId)

      const res = await POST(authed({ matchId }))
      const body = await res.json() as { sent: number; inapp_written: number }
      expect(body.sent).toBe(0)
      expect(body.inapp_written).toBe(1)
      expect(sendPushMock).not.toHaveBeenCalled()
    })

    it('push:true, inApp:false → push sent, no in-app row', async () => {
      await svc.from('profiles').update({
        notification_prefs: { match_live_bookmark: { push: true, inApp: false } },
      }).eq('id', userId)

      const res = await POST(authed({ matchId }))
      const body = await res.json() as { sent: number; inapp_written: number }
      expect(body.sent).toBe(1)
      expect(body.inapp_written).toBe(0)
      expect(sendPushMock).toHaveBeenCalledTimes(1)

      const { count } = await svc.from('user_notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      expect(count).toBe(0)
    })

    it('both off → no push, no in-app, user still counted as recipient', async () => {
      await svc.from('profiles').update({
        notification_prefs: { match_live_bookmark: { push: false, inApp: false } },
      }).eq('id', userId)

      const res = await POST(authed({ matchId }))
      const body = await res.json() as { recipients: number; sent: number; inapp_written: number }
      expect(body.recipients).toBe(1)
      expect(body.sent).toBe(0)
      expect(body.inapp_written).toBe(0)
    })

    it('push-send failure does not prevent in-app write', async () => {
      sendPushMock.mockImplementationOnce(async () => false)

      const res = await POST(authed({ matchId }))
      const body = await res.json() as { sent: number; inapp_written: number; stale_cleaned: number }
      expect(body.sent).toBe(0)
      expect(body.inapp_written).toBe(1)
      expect(body.stale_cleaned).toBe(1)
    })

    it('unauthorized without CRON_SECRET', async () => {
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ matchId }) }))
      expect(res.status).toBe(401)
    })
  })
  ```

- [ ] **Step 2: Run the tests.**

  ```bash
  npx vitest run src/app/api/push/notify/__tests__/route.test.ts
  ```

  Expected: all tests pass.

**Commit:** `test(push): notify prefs routing + channel independence`

---

## Task 12: `NotificationBell` component

**Files:**
- Create `src/components/NotificationBell.tsx`

- [ ] **Step 1: Write the component.**

  Write the following to `src/components/NotificationBell.tsx`:

  ```tsx
  'use client'
  // src/components/NotificationBell.tsx
  //
  // Header bell with unread-count badge. Renders null when logged out.
  // Polls GET /api/notifications/unread-count every 30s while the tab is
  // visible, pauses when hidden, and refetches on pageshow + on a custom
  // 'pn:notifications-updated' window event (dispatched by /notifications
  // after mark-read actions).

  import { useEffect, useState, useCallback } from 'react'
  import { useAuth } from '@/components/AuthProvider'
  import { useRouter } from '@/i18n/navigation'

  const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'
  const POLL_MS = 30_000

  export default function NotificationBell() {
    const { user } = useAuth()
    const router = useRouter()
    const [count, setCount] = useState(0)

    const fetchCount = useCallback(async () => {
      try {
        const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as { count: number }
        setCount(Math.max(0, body.count ?? 0))
      } catch { /* silent */ }
    }, [])

    // Mount fetch + polling + visibility handling + custom event + pageshow
    useEffect(() => {
      if (!user) return
      let active = true
      let intervalId: ReturnType<typeof setInterval> | null = null

      const start = () => {
        if (intervalId) return
        intervalId = setInterval(() => { if (active) void fetchCount() }, POLL_MS)
      }
      const stop = () => {
        if (!intervalId) return
        clearInterval(intervalId)
        intervalId = null
      }

      const onVisibility = () => {
        if (document.visibilityState === 'visible') {
          void fetchCount()
          start()
        } else {
          stop()
        }
      }
      const onPageshow = () => { void fetchCount() }
      const onUpdated = () => { void fetchCount() }

      void fetchCount()
      if (document.visibilityState === 'visible') start()
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pageshow', onPageshow)
      window.addEventListener('pn:notifications-updated', onUpdated)

      return () => {
        active = false
        stop()
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('pageshow', onPageshow)
        window.removeEventListener('pn:notifications-updated', onUpdated)
      }
    }, [user, fetchCount])

    if (!user) return null

    const display = count === 0 ? null : count >= 99 ? '99+' : String(count)
    const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications'

    return (
      <button
        aria-label={label}
        onClick={() => router.push('/notifications')}
        style={{
          position: 'relative',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.10)',
          clipPath: CHUNKY_BUTTON,
          width: 34, height: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          marginRight: 8,
          padding: 0,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {display !== null && (
          <span style={{
            position: 'absolute',
            top: -4, right: -4,
            minWidth: 12, height: 12,
            padding: '0 3px',
            borderRadius: 6,
            background: '#FF4655',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: '12px',
            textAlign: 'center',
            border: '2px solid #0A0A0A',
          }}>
            {display}
          </span>
        )}
      </button>
    )
  }
  ```

**Commit:** `feat(notifications): add NotificationBell header component`

---

## Task 13: Mount the bell in `AppHeader`

**Files:**
- Modify `src/components/AppHeader.tsx`

- [ ] **Step 1: Import the bell at the top.**

  Edit `src/components/AppHeader.tsx`:

  Change:
  ```ts
  import ProfileButton from '@/components/ProfileButton'
  ```
  to:
  ```ts
  import ProfileButton from '@/components/ProfileButton'
  import NotificationBell from '@/components/NotificationBell'
  ```

- [ ] **Step 2: Insert `<NotificationBell />` between Share and Profile.**

  Change:
  ```tsx
        {/* Profile / Login */}
        <ProfileButton />
  ```
  to:
  ```tsx
        {/* Notifications bell — hidden when logged out */}
        {mounted && <NotificationBell />}

        {/* Profile / Login */}
        <ProfileButton />
  ```

- [ ] **Step 3: Lint.**

  ```bash
  npm run lint -- --max-warnings 0
  ```

  Expected: no errors.

**Commit:** `feat(header): mount NotificationBell between share and profile`

---

## Task 14: `NotificationRow` component

**Files:**
- Create `src/components/NotificationRow.tsx`

- [ ] **Step 1: Write the component.**

  Write the following to `src/components/NotificationRow.tsx`:

  ```tsx
  'use client'
  // src/components/NotificationRow.tsx
  //
  // Single row inside /notifications. Left tile uses the V3 chunky clip
  // + a color-coded background + outline SVG icon. Middle column is title
  // over body (2-line clamp). Right is a relative timestamp. Unread rows
  // get a green left border + green chunky dot.

  import { useRouter } from '@/i18n/navigation'
  import type { CSSProperties } from 'react'
  import { useFormatter } from 'next-intl'

  const CHUNKY_TILE = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'

  type Category =
    | 'match_live_follow'
    | 'match_live_bookmark'
    | 'match_finished'
    | 'match_upcoming'
    | 'badge_earned'
    | 'streak_milestone'
    | 'marketing'

  const CATEGORY_VISUAL: Record<Category, { color: string; icon: 'bell' | 'checkmark' | 'star' | 'lightbulb' | 'globe' }> = {
    match_live_follow:   { color: '#FF4655', icon: 'bell' },
    match_live_bookmark: { color: '#FF4655', icon: 'bell' },
    match_finished:      { color: '#7ED321', icon: 'checkmark' },
    match_upcoming:      { color: '#F5A623', icon: 'bell' },
    badge_earned:        { color: '#F5A623', icon: 'star' },
    streak_milestone:    { color: '#FF6B35', icon: 'lightbulb' },
    marketing:           { color: '#D4AF37', icon: 'globe' },
  }

  function IconSvg({ name }: { name: 'bell' | 'checkmark' | 'star' | 'lightbulb' | 'globe' }) {
    const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: '#0A0A0A', strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
    switch (name) {
      case 'bell': return <svg {...common}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      case 'checkmark': return <svg {...common}><polyline points="20 6 9 17 4 12"/></svg>
      case 'star': return <svg {...common}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      case 'lightbulb': return <svg {...common}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
      case 'globe': return <svg {...common}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
    }
  }

  function relativeTime(iso: string, now = Date.now()): string {
    const t = new Date(iso).getTime()
    const diffSec = Math.max(0, Math.floor((now - t) / 1000))
    if (diffSec < 60) return `${diffSec}s`
    const mins = Math.floor(diffSec / 60)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    const days = Math.floor(hrs / 24)
    if (days === 1) return 'Yesterday'
    return ''
  }

  export interface NotificationRowData {
    id: string
    category: string
    title: string
    body: string | null
    url: string | null
    metadata: Record<string, unknown>
    read_at: string | null
    created_at: string
  }

  export default function NotificationRow({
    row,
    onMarkRead,
  }: {
    row: NotificationRowData
    onMarkRead: (id: string) => void
  }) {
    const router = useRouter()
    const format = useFormatter()
    const visual = CATEGORY_VISUAL[row.category as Category] ?? { color: '#888', icon: 'bell' as const }
    const isUnread = !row.read_at
    const rel = relativeTime(row.created_at)
    const stamp = rel || format.dateTime(new Date(row.created_at), { month: 'short', day: 'numeric' })

    const buttonStyle: CSSProperties = {
      width: '100%',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '12px 14px',
      background: 'transparent',
      border: 'none',
      borderLeft: isUnread ? '2px solid #7ED321' : '2px solid transparent',
      color: '#fff',
      textAlign: 'left',
      cursor: 'pointer',
    }

    const handleClick = () => {
      if (isUnread) onMarkRead(row.id)
      if (row.url) router.push(row.url as string & Parameters<typeof router.push>[0])
    }

    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={isUnread ? `${row.title} — unread` : row.title}
        style={buttonStyle}
      >
        <span style={{
          flexShrink: 0,
          width: 48, height: 48,
          background: visual.color,
          clipPath: CHUNKY_TILE,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <IconSvg name={visual.icon} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', flex: 1 }}>{row.title}</span>
            {isUnread && (
              <span style={{
                width: 6, height: 6,
                background: '#7ED321',
                clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                flexShrink: 0,
              }} />
            )}
          </span>
          {row.body && (
            <span style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
              fontSize: 12,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.55)',
              marginTop: 2,
            }}>
              {row.body}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {stamp}
        </span>
      </button>
    )
  }
  ```

**Commit:** `feat(notifications): NotificationRow component`

---

## Task 15: `/notifications` page

**Files:**
- Create `src/app/[locale]/(app)/notifications/page.tsx`

- [ ] **Step 1: Write the page.**

  Write the following to `src/app/[locale]/(app)/notifications/page.tsx`:

  ```tsx
  'use client'
  // src/app/[locale]/(app)/notifications/page.tsx
  //
  // Notification center: sub-header, filter pills, day-grouped list,
  // infinite scroll, mark-all-read. Inherits AppHeader + BottomNav from
  // the (app) layout. Client component — fetches on mount, refetches when
  // filter changes.

  import { useEffect, useRef, useState, useCallback } from 'react'
  import { useTranslations, useFormatter } from 'next-intl'
  import { useRouter } from '@/i18n/navigation'
  import NotificationRow, { type NotificationRowData } from '@/components/NotificationRow'

  type Filter = 'all' | 'matches' | 'badges'

  function dayBucket(iso: string, timezone: string | undefined, locale: string): string {
    const d = new Date(iso)
    const now = new Date()
    const optTz = timezone ? { timeZone: timezone } : {}
    const ymd = (x: Date) => new Intl.DateTimeFormat('en-CA', { ...optTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
    const today = ymd(now)
    const y = new Date(now); y.setDate(y.getDate() - 1); const yd = ymd(y)
    const dy = ymd(d)
    if (dy === today) return 'today'
    if (dy === yd) return 'yesterday'
    const diffMs = now.getTime() - d.getTime()
    if (diffMs < 7 * 24 * 60 * 60 * 1000) return 'thisWeek'
    return new Intl.DateTimeFormat(locale, { ...optTz, month: 'short', day: 'numeric' }).format(d)
  }

  export default function NotificationsPage() {
    const t = useTranslations('notifications')
    const format = useFormatter()
    const router = useRouter()

    const [filter, setFilter] = useState<Filter>('all')
    const [items, setItems] = useState<NotificationRowData[]>([])
    const [cursor, setCursor] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(true)
    const [loading, setLoading] = useState(false)
    const [unreadCount, setUnreadCount] = useState(0)
    const sentinelRef = useRef<HTMLDivElement>(null)

    const fetchPage = useCallback(async (reset: boolean) => {
      if (loading) return
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('filter', filter)
        qs.set('limit', '30')
        if (!reset && cursor) qs.set('before', cursor)
        const res = await fetch(`/api/notifications?${qs.toString()}`, { cache: 'no-store' })
        const body = await res.json() as { items: NotificationRowData[]; nextCursor: string | null }
        setItems(prev => reset ? body.items : [...prev, ...body.items])
        setCursor(body.nextCursor)
        setHasMore(!!body.nextCursor)
      } finally {
        setLoading(false)
      }
    }, [filter, cursor, loading])

    const fetchUnread = useCallback(async () => {
      try {
        const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
        const body = await res.json() as { count: number }
        setUnreadCount(body.count ?? 0)
      } catch { /* silent */ }
    }, [])

    // Reset list on filter change
    useEffect(() => {
      setItems([])
      setCursor(null)
      setHasMore(true)
      void fetchPage(true)
      void fetchUnread()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter])

    // Infinite scroll
    useEffect(() => {
      const el = sentinelRef.current
      if (!el || !hasMore) return
      const obs = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting && !loading) void fetchPage(false)
      }, { rootMargin: '240px' })
      obs.observe(el)
      return () => obs.disconnect()
    }, [hasMore, loading, fetchPage])

    const markOne = useCallback(async (id: string) => {
      setItems(prev => prev.map(i => i.id === id ? { ...i, read_at: new Date().toISOString() } : i))
      setUnreadCount(c => Math.max(0, c - 1))
      try {
        await fetch('/api/notifications/mark-read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [id] }),
        })
      } finally {
        window.dispatchEvent(new Event('pn:notifications-updated'))
      }
    }, [])

    const markAll = useCallback(async () => {
      const prev = items
      setItems(p => p.map(i => i.read_at ? i : { ...i, read_at: new Date().toISOString() }))
      setUnreadCount(0)
      try {
        const res = await fetch('/api/notifications/mark-read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ all: true }),
        })
        if (!res.ok) throw new Error('mark-all failed')
      } catch {
        setItems(prev)
        void fetchUnread()
      } finally {
        window.dispatchEvent(new Event('pn:notifications-updated'))
      }
    }, [items, fetchUnread])

    // Bucket items by day
    const timezone = typeof document !== 'undefined'
      ? (document.cookie.split('; ').find(c => c.startsWith('geo-timezone='))?.split('=')[1])
      : undefined
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'
    const groups: Array<{ key: string; label: string; rows: NotificationRowData[] }> = []
    for (const row of items) {
      const bucket = dayBucket(row.created_at, timezone, locale)
      let label: string
      if (bucket === 'today') label = t('daySeparator.today')
      else if (bucket === 'yesterday') label = t('daySeparator.yesterday')
      else if (bucket === 'thisWeek') label = t('daySeparator.thisWeek')
      else label = bucket
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.rows.push(row)
      else groups.push({ key: `${bucket}-${groups.length}`, label, rows: [row] })
    }

    return (
      <main style={{ paddingBottom: 80, background: '#0A0A0A', minHeight: '100vh' }}>
        {/* Sub-header */}
        <div style={{
          position: 'sticky', top: 62, zIndex: 10,
          background: '#0A0A0A',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => router.back()}
              aria-label="Back"
              style={{ background: 'transparent', border: 'none', color: '#7ED321', cursor: 'pointer', padding: 0 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{t('title')}</h1>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => void markAll()}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#7ED321',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {t('markAllRead')}
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px' }}>
          {(['all', 'matches', 'badges'] as Filter[]).map((f) => {
            const active = filter === f
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 999,
                  border: active ? 'none' : '1px solid rgba(255,255,255,0.12)',
                  background: active ? '#7ED321' : 'rgba(255,255,255,0.06)',
                  color: active ? '#0A0A0A' : 'rgba(255,255,255,0.85)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {f === 'all' ? t('filterAll') : f === 'matches' ? t('filterMatches') : t('filterBadges')}
              </button>
            )
          })}
        </div>

        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {loading && items.length === 0 && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
              …
            </div>
          )}
          {!loading && items.length === 0 && (
            <div style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t('empty')}</div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>{t('emptySubtitle')}</div>
            </div>
          )}
          {groups.map(g => (
            <div key={g.key}>
              <div style={{
                padding: '10px 16px 4px',
                fontSize: 11,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                fontWeight: 700,
              }}>
                {g.label}
              </div>
              {g.rows.map(row => (
                <NotificationRow key={row.id} row={row} onMarkRead={markOne} />
              ))}
            </div>
          ))}
          {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
        </div>
        {/* Silence the unused-var warning for format in environments that tree-shake */}
        {false && format.dateTime(new Date())}
      </main>
    )
  }
  ```

- [ ] **Step 2: Start the dev server and verify the route renders.**

  ```bash
  npm run dev
  ```

  Navigate to `http://localhost:3002/notifications` while logged in. Expected: sub-header with back button + "Notifications" title + filter pills. Empty state shows if you have no rows.

**Commit:** `feat(notifications): /notifications page with filters + infinite scroll`

---

## Task 16: `/profile/settings/notifications` granular prefs sub-page

**Files:**
- Create `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`

- [ ] **Step 1: Write the page.**

  Write the following to `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`:

  ```tsx
  'use client'
  // src/app/[locale]/(app)/profile/settings/notifications/page.tsx
  //
  // Granular notification preferences:
  //   - Permission-denied banner (when Notification.permission === 'denied')
  //   - Master push toggle (reuses usePushNotifications)
  //   - Category rows grouped by "Matches", "Achievements", "Other"
  //   - Two toggles per row (PUSH, IN-APP); push column dims when master is off.

  import { useEffect, useState, useCallback } from 'react'
  import { useTranslations } from 'next-intl'
  import { useRouter } from '@/i18n/navigation'
  import { usePushNotifications } from '@/hooks/usePushNotifications'
  import { KNOWN_CATEGORIES, type NotificationCategory, type ChannelPrefs } from '@/lib/notification-categories'

  type Group = { key: 'groupMatches' | 'groupAchievements' | 'groupOther'; categories: NotificationCategory[] }
  const GROUPS: Group[] = [
    { key: 'groupMatches', categories: ['match_live_follow', 'match_live_bookmark', 'match_finished', 'match_upcoming'] },
    { key: 'groupAchievements', categories: ['badge_earned', 'streak_milestone'] },
    { key: 'groupOther', categories: ['marketing'] },
  ]

  function Toggle({ on, onChange, disabled, ariaLabel }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel: string }) {
    return (
      <button
        aria-label={ariaLabel}
        aria-pressed={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        style={{
          width: 36, height: 20,
          borderRadius: 999,
          border: 'none',
          background: on ? '#7ED321' : 'rgba(255,255,255,0.18)',
          position: 'relative',
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: 0,
          transition: 'background 0.15s',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{
          position: 'absolute',
          top: 2, left: on ? 18 : 2,
          width: 16, height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }}/>
      </button>
    )
  }

  export default function NotificationPrefsPage() {
    const t = useTranslations('notifications.settings')
    const router = useRouter()
    const { enabled: pushEnabled, toggle: togglePush, permission, supported } = usePushNotifications()
    const [prefs, setPrefs] = useState<Record<NotificationCategory, ChannelPrefs> | null>(null)
    const [toast, setToast] = useState<string | null>(null)

    useEffect(() => {
      let cancelled = false
      ;(async () => {
        try {
          const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
          if (!res.ok) return
          const body = await res.json() as { prefs: Record<NotificationCategory, ChannelPrefs> }
          if (!cancelled) setPrefs(body.prefs)
        } catch { /* silent */ }
      })()
      return () => { cancelled = true }
    }, [])

    const patch = useCallback(async (category: NotificationCategory, patch: Partial<ChannelPrefs>) => {
      if (!prefs) return
      const prev = prefs
      const next = { ...prefs, [category]: { ...prefs[category], ...patch } }
      setPrefs(next)
      try {
        const res = await fetch('/api/user/notification-prefs', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category, ...patch }),
        })
        if (!res.ok) throw new Error('save failed')
      } catch {
        setPrefs(prev)
        setToast(t('saveError'))
        setTimeout(() => setToast(null), 2500)
      }
    }, [prefs, t])

    const permissionDenied = supported && permission === 'denied'

    return (
      <main style={{ paddingBottom: 80, background: '#0A0A0A', minHeight: '100vh' }}>
        {/* Sub-header */}
        <div style={{
          position: 'sticky', top: 62, zIndex: 10,
          background: '#0A0A0A',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <button onClick={() => router.back()} aria-label="Back" style={{ background: 'transparent', border: 'none', color: '#7ED321', cursor: 'pointer', padding: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{t('title')}</h1>
        </div>

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {permissionDenied && (
            <div style={{
              background: 'rgba(245,166,35,0.08)',
              border: '1px solid rgba(245,166,35,0.35)',
              padding: '10px 12px',
              borderRadius: 6,
            }}>
              <div style={{ color: '#F5A623', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{t('permissionDeniedTitle')}</div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{t('permissionDeniedBody')}</div>
            </div>
          )}

          {/* Master push toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{t('masterLabel')}</span>
            <Toggle
              on={pushEnabled}
              onChange={() => void togglePush()}
              disabled={!supported || permissionDenied}
              ariaLabel={t('masterLabel')}
            />
          </div>

          {/* Column header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 60px 60px',
            gap: 8,
            padding: '0 14px',
            fontSize: 11,
            letterSpacing: 0.5,
            color: 'rgba(255,255,255,0.45)',
            fontWeight: 700,
          }}>
            <span />
            <span style={{ textAlign: 'center' }}>{t('columnPush')}</span>
            <span style={{ textAlign: 'center' }}>{t('columnInApp')}</span>
          </div>

          {prefs && GROUPS.map(group => (
            <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, padding: '6px 14px' }}>
                {t(group.key)}
              </div>
              {group.categories.map(cat => {
                const pref = prefs[cat]
                const pushDim = !pushEnabled
                return (
                  <div key={cat} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 60px 60px',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div>
                      <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{t(`category.${cat}.label`)}</div>
                      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2 }}>{t(`category.${cat}.sub`)}</div>
                    </div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      opacity: pushDim ? 0.3 : 1,
                      pointerEvents: pushDim ? 'none' : 'auto',
                    }}>
                      <Toggle
                        on={pushDim ? false : pref.push}
                        onChange={(v) => void patch(cat, { push: v })}
                        ariaLabel={`${t(`category.${cat}.label`)} push`}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Toggle
                        on={pref.inApp}
                        onChange={(v) => void patch(cat, { inApp: v })}
                        ariaLabel={`${t(`category.${cat}.label`)} in-app`}
                      />
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
        </div>

        {toast && (
          <div style={{
            position: 'fixed',
            bottom: 80, left: 16, right: 16,
            background: '#FF4655',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
            zIndex: 100,
          }}>
            {toast}
          </div>
        )}

        {/* KNOWN_CATEGORIES keeps the import live if a future reducer needs it */}
        {false && <span>{KNOWN_CATEGORIES.join(',')}</span>}
      </main>
    )
  }
  ```

- [ ] **Step 2: Verify the route renders.**

  With dev server running, navigate to `http://localhost:3002/profile/settings/notifications` while logged in. Expected: master push row + three grouped sections with category toggles.

**Commit:** `feat(notifications): granular prefs sub-page at /profile/settings/notifications`

---

## Task 17: Add `notifications` namespace to `en.json`

**Files:**
- Modify `src/messages/en.json`

- [ ] **Step 1: Locate the closing brace of the root object.**

  Open `src/messages/en.json` and find the final `}`.

- [ ] **Step 2: Insert the `notifications` namespace before the final `}`.**

  Add this block (comma-prefixed if it goes after an existing entry):

  ```json
    "notifications": {
      "title": "Notifications",
      "markAllRead": "Mark all read",
      "filterAll": "All",
      "filterMatches": "Matches",
      "filterBadges": "Badges",
      "empty": "No notifications yet",
      "emptySubtitle": "We'll let you know when your matches go live",
      "daySeparator": {
        "today": "Today",
        "yesterday": "Yesterday",
        "thisWeek": "This week"
      },
      "settings": {
        "title": "Notifications",
        "permissionDeniedTitle": "Notifications blocked",
        "permissionDeniedBody": "Push notifications won't arrive until you re-enable them in your browser settings.",
        "masterLabel": "Push notifications",
        "columnPush": "PUSH",
        "columnInApp": "IN-APP",
        "groupMatches": "Matches",
        "groupAchievements": "Achievements",
        "groupOther": "Other",
        "category": {
          "match_live_follow":    { "label": "Followed player goes live",  "sub": "When a player you follow is about to play" },
          "match_live_bookmark":  { "label": "Bookmarked match goes live", "sub": "When a match you saved starts" },
          "match_finished":       { "label": "Match finished",             "sub": "Results for matches you follow" },
          "match_upcoming":       { "label": "Match starting soon",        "sub": "30 min before a followed match" },
          "badge_earned":         { "label": "Badge earned",               "sub": "When you unlock a new badge" },
          "streak_milestone":     { "label": "Streak milestone",           "sub": "3, 7, 30, 100-day streaks" },
          "marketing":            { "label": "Product updates",            "sub": "New features, events, occasional news" }
        },
        "saveError": "Couldn't save — please try again"
      },
      "settingsLinkRow": {
        "label": "Notifications",
        "sub": "Choose what you're notified about"
      }
    }
  ```

- [ ] **Step 3: Validate the JSON.**

  ```bash
  node -e "JSON.parse(require('fs').readFileSync('src/messages/en.json','utf8')); console.log('ok')"
  ```

  Expected: `ok`.

**Commit:** `feat(i18n): add notifications namespace to en.json`

---

## Task 18: Replace Phase 1 toggle row with navigation link on `/profile/settings`

> **Precondition:** Phase 1 ships the file `src/app/[locale]/(app)/profile/settings/page.tsx` with a "Push notifications" toggle row wired to `usePushNotifications().toggle`. This task amends that row.

**Files:**
- Modify `src/app/[locale]/(app)/profile/settings/page.tsx`

- [ ] **Step 1: Confirm Phase 1 file exists.**

  ```bash
  ls src/app/\[locale\]/\(app\)/profile/settings/page.tsx
  ```

  Expected: prints the path. If it does not exist, stop — Phase 1 must ship first. Document this blocker and skip remaining steps in this task.

- [ ] **Step 2: Replace the push-notifications toggle row with a link row.**

  Inside the settings page, locate the JSX block that renders the "Push notifications" toggle (it uses `usePushNotifications()` and a `<Toggle on={enabled} onChange={toggle} />`-like pattern). Replace that single row with:

  ```tsx
  {/* Notifications navigation row — replaces the Phase 1 push toggle */}
  <button
    type="button"
    onClick={() => router.push('/profile/settings/notifications')}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: '14px 16px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      color: '#fff',
      textAlign: 'left',
      cursor: 'pointer',
    }}
  >
    <span>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
        {t('notifications.settingsLinkRow.label')}
      </span>
      <span style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
        {t('notifications.settingsLinkRow.sub')}
      </span>
    </span>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  </button>
  ```

  At the top of the file, ensure `useRouter` and `useTranslations` are imported:
  ```ts
  import { useRouter } from '@/i18n/navigation'
  import { useTranslations } from 'next-intl'
  ```

  And inside the component:
  ```ts
  const router = useRouter()
  const t = useTranslations()
  ```

  Remove the old `usePushNotifications` import + hook call + toggle JSX for that row. (Master push toggle now lives on the sub-page — this row is a nav link only.)

- [ ] **Step 3: Lint.**

  ```bash
  npm run lint -- --max-warnings 0
  ```

  Expected: no errors.

**Commit:** `refactor(settings): replace push toggle with notifications link row`

---

## Task 19: Translate `notifications` namespace into es / pt / it / fr

**Files:**
- Modify `src/messages/es.json`
- Modify `src/messages/pt.json`
- Modify `src/messages/it.json`
- Modify `src/messages/fr.json`

- [ ] **Step 1: Add the `notifications` block to `src/messages/es.json`.**

  Insert before the final `}`:

  ```json
    "notifications": {
      "title": "Notificaciones",
      "markAllRead": "Marcar todo como leído",
      "filterAll": "Todo",
      "filterMatches": "Partidos",
      "filterBadges": "Logros",
      "empty": "Aún no hay notificaciones",
      "emptySubtitle": "Te avisaremos cuando tus partidos empiecen",
      "daySeparator": {
        "today": "Hoy",
        "yesterday": "Ayer",
        "thisWeek": "Esta semana"
      },
      "settings": {
        "title": "Notificaciones",
        "permissionDeniedTitle": "Notificaciones bloqueadas",
        "permissionDeniedBody": "Las notificaciones push no llegarán hasta que las vuelvas a activar en la configuración de tu navegador.",
        "masterLabel": "Notificaciones push",
        "columnPush": "PUSH",
        "columnInApp": "EN APP",
        "groupMatches": "Partidos",
        "groupAchievements": "Logros",
        "groupOther": "Otros",
        "category": {
          "match_live_follow":    { "label": "Jugador seguido en directo", "sub": "Cuando un jugador que sigues va a jugar" },
          "match_live_bookmark":  { "label": "Partido guardado en directo", "sub": "Cuando comienza un partido que has guardado" },
          "match_finished":       { "label": "Partido finalizado", "sub": "Resultados de los partidos que sigues" },
          "match_upcoming":       { "label": "Partido a punto de empezar", "sub": "30 min antes de un partido seguido" },
          "badge_earned":         { "label": "Insignia ganada", "sub": "Cuando desbloqueas una nueva insignia" },
          "streak_milestone":     { "label": "Racha alcanzada", "sub": "Rachas de 3, 7, 30 y 100 días" },
          "marketing":            { "label": "Novedades del producto", "sub": "Nuevas funciones, eventos y noticias ocasionales" }
        },
        "saveError": "No se pudo guardar — inténtalo de nuevo"
      },
      "settingsLinkRow": {
        "label": "Notificaciones",
        "sub": "Elige sobre qué te avisamos"
      }
    }
  ```

- [ ] **Step 2: Add the block to `src/messages/pt.json`.**

  Insert before the final `}`:

  ```json
    "notifications": {
      "title": "Notificações",
      "markAllRead": "Marcar tudo como lido",
      "filterAll": "Tudo",
      "filterMatches": "Jogos",
      "filterBadges": "Conquistas",
      "empty": "Ainda não há notificações",
      "emptySubtitle": "Avisamos quando os teus jogos começarem",
      "daySeparator": {
        "today": "Hoje",
        "yesterday": "Ontem",
        "thisWeek": "Esta semana"
      },
      "settings": {
        "title": "Notificações",
        "permissionDeniedTitle": "Notificações bloqueadas",
        "permissionDeniedBody": "As notificações push só chegarão depois de as reativares nas configurações do navegador.",
        "masterLabel": "Notificações push",
        "columnPush": "PUSH",
        "columnInApp": "NA APP",
        "groupMatches": "Jogos",
        "groupAchievements": "Conquistas",
        "groupOther": "Outros",
        "category": {
          "match_live_follow":    { "label": "Jogador que segues em direto", "sub": "Quando um jogador que segues vai jogar" },
          "match_live_bookmark":  { "label": "Jogo guardado em direto", "sub": "Quando começa um jogo que guardaste" },
          "match_finished":       { "label": "Jogo terminado", "sub": "Resultados dos jogos que segues" },
          "match_upcoming":       { "label": "Jogo prestes a começar", "sub": "30 min antes de um jogo seguido" },
          "badge_earned":         { "label": "Emblema conquistado", "sub": "Quando desbloqueias um novo emblema" },
          "streak_milestone":     { "label": "Sequência atingida", "sub": "Sequências de 3, 7, 30 e 100 dias" },
          "marketing":            { "label": "Novidades do produto", "sub": "Novas funções, eventos e notícias ocasionais" }
        },
        "saveError": "Não foi possível guardar — tenta novamente"
      },
      "settingsLinkRow": {
        "label": "Notificações",
        "sub": "Escolhe sobre o que queres ser avisado"
      }
    }
  ```

- [ ] **Step 3: Add the block to `src/messages/it.json`.**

  Insert before the final `}`:

  ```json
    "notifications": {
      "title": "Notifiche",
      "markAllRead": "Segna tutto come letto",
      "filterAll": "Tutto",
      "filterMatches": "Partite",
      "filterBadges": "Traguardi",
      "empty": "Ancora nessuna notifica",
      "emptySubtitle": "Ti avviseremo quando inizieranno le tue partite",
      "daySeparator": {
        "today": "Oggi",
        "yesterday": "Ieri",
        "thisWeek": "Questa settimana"
      },
      "settings": {
        "title": "Notifiche",
        "permissionDeniedTitle": "Notifiche bloccate",
        "permissionDeniedBody": "Le notifiche push non arriveranno finché non le riattivi nelle impostazioni del browser.",
        "masterLabel": "Notifiche push",
        "columnPush": "PUSH",
        "columnInApp": "IN-APP",
        "groupMatches": "Partite",
        "groupAchievements": "Traguardi",
        "groupOther": "Altro",
        "category": {
          "match_live_follow":    { "label": "Giocatore seguito in diretta", "sub": "Quando un giocatore che segui sta per giocare" },
          "match_live_bookmark":  { "label": "Partita salvata in diretta", "sub": "Quando inizia una partita che hai salvato" },
          "match_finished":       { "label": "Partita terminata", "sub": "Risultati delle partite che segui" },
          "match_upcoming":       { "label": "Partita sta per iniziare", "sub": "30 min prima di una partita seguita" },
          "badge_earned":         { "label": "Distintivo ottenuto", "sub": "Quando sblocchi un nuovo distintivo" },
          "streak_milestone":     { "label": "Striscia raggiunta", "sub": "Strisce da 3, 7, 30 e 100 giorni" },
          "marketing":            { "label": "Novità del prodotto", "sub": "Nuove funzioni, eventi e notizie occasionali" }
        },
        "saveError": "Impossibile salvare — riprova"
      },
      "settingsLinkRow": {
        "label": "Notifiche",
        "sub": "Scegli per cosa ricevere notifiche"
      }
    }
  ```

- [ ] **Step 4: Add the block to `src/messages/fr.json`.**

  Insert before the final `}`:

  ```json
    "notifications": {
      "title": "Notifications",
      "markAllRead": "Tout marquer comme lu",
      "filterAll": "Tout",
      "filterMatches": "Matchs",
      "filterBadges": "Badges",
      "empty": "Aucune notification pour le moment",
      "emptySubtitle": "Nous vous avertirons quand vos matchs commenceront",
      "daySeparator": {
        "today": "Aujourd'hui",
        "yesterday": "Hier",
        "thisWeek": "Cette semaine"
      },
      "settings": {
        "title": "Notifications",
        "permissionDeniedTitle": "Notifications bloquées",
        "permissionDeniedBody": "Les notifications push n'arriveront pas tant que vous ne les réactiverez pas dans les paramètres du navigateur.",
        "masterLabel": "Notifications push",
        "columnPush": "PUSH",
        "columnInApp": "IN-APP",
        "groupMatches": "Matchs",
        "groupAchievements": "Badges",
        "groupOther": "Autres",
        "category": {
          "match_live_follow":    { "label": "Joueur suivi en direct", "sub": "Quand un joueur que vous suivez va jouer" },
          "match_live_bookmark":  { "label": "Match enregistré en direct", "sub": "Quand un match que vous avez enregistré commence" },
          "match_finished":       { "label": "Match terminé", "sub": "Résultats des matchs que vous suivez" },
          "match_upcoming":       { "label": "Match sur le point de commencer", "sub": "30 min avant un match suivi" },
          "badge_earned":         { "label": "Badge obtenu", "sub": "Quand vous débloquez un nouveau badge" },
          "streak_milestone":     { "label": "Série atteinte", "sub": "Séries de 3, 7, 30 et 100 jours" },
          "marketing":            { "label": "Nouveautés produit", "sub": "Nouvelles fonctionnalités, événements, actualités" }
        },
        "saveError": "Enregistrement impossible — réessayez"
      },
      "settingsLinkRow": {
        "label": "Notifications",
        "sub": "Choisissez pour quoi être notifié"
      }
    }
  ```

- [ ] **Step 5: Validate every JSON file.**

  ```bash
  for f in src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json; do
    node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f ok')"
  done
  ```

  Expected: five `ok` lines.

**Commit:** `feat(i18n): translate notifications namespace to es/pt/it/fr`

---

## Task 20: Manual QA + final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run all unit + integration tests.**

  ```bash
  npx vitest run src/lib/__tests__/notification-categories.test.ts src/app/api/notifications/__tests__/route.test.ts src/app/api/push/notify/__tests__/route.test.ts
  ```

  Expected: all green.

- [ ] **Step 2: Run the full lint.**

  ```bash
  npm run lint -- --max-warnings 0
  ```

  Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 3: Run the production build to catch any app-router type issues.**

  ```bash
  npm run build
  ```

  Expected: build succeeds with no type errors.

- [ ] **Step 4: Walk the manual QA script from the spec.**

  With `npm run dev` running and logged in:

  1. Bookmark a match → trigger `/api/push/notify` manually with `curl -H "Authorization: Bearer $CRON_SECRET" -H "content-type: application/json" -d '{"matchId":"<id>"}' http://localhost:3002/api/push/notify` → verify push arrives + `/notifications` shows a new unread row.
  2. Open `/profile/settings/notifications`, disable `match_live_bookmark.push`, re-fire → verify no push, in-app row still appears.
  3. Disable both channels on `match_live_bookmark` → verify nothing arrives.
  4. Tap a row in `/notifications` → verify nav to `/match/{id}` + row becomes read + bell count drops by 1.
  5. Tap "Mark all read" → verify all rows dim + bell count becomes 0.
  6. Flip master push off → verify PUSH column dims and all push toggles appear off.
  7. Flip master back on → verify per-category push values restore.
  8. Open app in a second tab → verify bell count stays in sync within 30s.
  9. Revoke browser notification permission → verify denied banner appears; master toggle stays disabled without errors.
  10. Log out → verify bell disappears and `/notifications` redirects to login.

  Confirm each step before marking done. If any step fails, create a follow-up issue referencing the spec's "Manual QA script" (section at line ~460 of `2026-04-17-notification-center-design.md`).

**Commit:** `docs: verify notification center end-to-end QA`
