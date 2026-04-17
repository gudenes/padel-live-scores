# Profile Settings + Compliance Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close seven compliance and UX gaps on the user profile surface by shipping a new `/profile/settings` page, three authenticated user endpoints (account delete, data export, marketing-prefs), a gated analytics component, and one additive migration — without redesigning `/profile`.

**Architecture:** A single migration adds `profiles.marketing_opt_in`. Two pure helpers (`src/lib/delete-plan.ts`, `src/lib/export-bundle.ts`) are covered by vitest unit tests and called by thin route handlers (`DELETE /api/user/account`, `GET /api/user/export`, `PATCH /api/user/marketing-prefs`). A new `<GatedAnalytics>` client component replaces the unconditional `<Analytics />` in `app/layout.tsx`. The new settings page at `src/app/[locale]/(app)/profile/settings/page.tsx` consumes these endpoints and reuses existing `<CountryPicker>`, `<LocaleSwitcher>`, and `usePushNotifications` primitives. Access is a gear icon added to the existing `/profile` header.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · next-intl · Supabase · Auth.js v5 · vitest

**Spec:** `docs/superpowers/specs/2026-04-17-profile-settings-compliance-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260417_profile_compliance.sql` | Create | Adds `profiles.marketing_opt_in BOOLEAN NOT NULL DEFAULT false` |
| `src/lib/delete-plan.ts` | Create | Pure function returning the ordered `{ sql, params }[]` for the account-delete transaction |
| `src/lib/__tests__/delete-plan.test.ts` | Create | Vitest unit tests for delete-plan ordering and parameterization |
| `src/lib/export-bundle.ts` | Create | Pure bundle assembler: takes raw rows, returns `UserExportBundle`; redacts push keys |
| `src/lib/__tests__/export-bundle.test.ts` | Create | Vitest unit tests for bundle shape, redaction, and empty-user case |
| `src/lib/pg.ts` | Create | Shared `Pool` factory using the same `parseDbUrl` helper as `src/auth.ts` (avoids circular import) |
| `src/app/api/user/account/route.ts` | Create | `DELETE` handler that runs delete-plan inside a single BEGIN/COMMIT transaction |
| `src/app/api/user/account/types.ts` | Create | `AccountDeleteErrorResponse` type |
| `src/app/api/user/export/route.ts` | Create | `GET` handler that assembles the export bundle and returns it as a JSON download |
| `src/app/api/user/export/types.ts` | Create | `UserExportBundle` interface |
| `src/app/api/user/marketing-prefs/route.ts` | Create | `PATCH` handler writing `profiles.marketing_opt_in` |
| `src/app/api/user/marketing-prefs/types.ts` | Create | Request + response types for marketing prefs |
| `src/app/api/user/profile/route.ts` | Modify | Extend GET `select` + PATCH allowlist to include `marketing_opt_in` |
| `src/components/GatedAnalytics.tsx` | Create | Client component that reads `pn_analytics_opt_out` from localStorage and conditionally renders `<Analytics />` |
| `src/app/layout.tsx` | Modify | Replace `<Analytics />` with `<GatedAnalytics />` |
| `src/app/[locale]/(app)/profile/settings/page.tsx` | Create | The new settings page (client component) |
| `src/app/[locale]/(app)/profile/settings/DeleteAccountModal.tsx` | Create | Two-step confirmation modal used by the settings page |
| `src/app/[locale]/(app)/profile/settings/EditNameSheet.tsx` | Create | Bottom sheet for editing the display name |
| `src/app/[locale]/(app)/profile/page.tsx` | Modify | Replace the empty 36×36 spacer at the right of the header with a gear icon `<Link href="/profile/settings">` |
| `src/messages/en.json` | Modify | Add `settings` namespace (English source strings) |
| `src/messages/es.json` | Modify | Add `settings` namespace (Spanish) |
| `src/messages/pt.json` | Modify | Add `settings` namespace (Portuguese) |
| `src/messages/it.json` | Modify | Add `settings` namespace (Italian) |
| `src/messages/fr.json` | Modify | Add `settings` namespace (French) |

**Branch:** `claude/profile-settings-compliance` (create before Task 1 if not already on it).

**Manual steps required from the user:**
1. Apply the migration `supabase/migrations/20260417_profile_compliance.sql` via the Supabase dashboard SQL editor before merging the endpoints that read `marketing_opt_in`. The migration is additive with a `DEFAULT false`, so it is safe to run ahead of any code rollout.
2. After the full feature merges to main and deploys, do a one-pass QA using a throwaway Google account (see spec §Testing strategy → Manual QA checklist).

---

## Task 1: Migration — `profiles.marketing_opt_in`

**Files:**
- Create: `supabase/migrations/20260417_profile_compliance.sql`

- [ ] **Step 1: Write the migration**

  Create `supabase/migrations/20260417_profile_compliance.sql` with this exact content:

  ```sql
  -- 20260417_profile_compliance.sql
  -- Adds the marketing email consent column required by the Phase 1
  -- compliance foundations work (GDPR Art. 7). Default false — consent must
  -- be explicit. Set via PATCH /api/user/marketing-prefs.

  ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false;

  COMMENT ON COLUMN public.profiles.marketing_opt_in IS
    'User consent for broadcast marketing emails. Set via /api/user/marketing-prefs. Default false (opt-in model).';
  ```

- [ ] **Step 2: Apply the migration to Supabase**

  This is a manual step for the operator — paste the SQL from Step 1 into the Supabase dashboard SQL editor and run it. Verify with:

  ```sql
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'marketing_opt_in';
  ```

  Expected output: one row with `data_type=boolean`, `column_default=false`, `is_nullable=NO`.

- [ ] **Step 3: Commit**

  ```bash
  git add supabase/migrations/20260417_profile_compliance.sql
  git commit -m "feat(db): add profiles.marketing_opt_in column for GDPR consent"
  ```

---

## Task 2: Pure helper — `delete-plan.ts` (tests first)

**Files:**
- Create: `src/lib/__tests__/delete-plan.test.ts`
- Create: `src/lib/delete-plan.ts`

- [ ] **Step 1: Write the failing test file**

  Create `src/lib/__tests__/delete-plan.test.ts`:

  ```ts
  /**
   * delete-plan.test.ts
   *
   * Unit tests for the pure account-delete SQL plan generator.
   * Run with: npx vitest run src/lib/__tests__/delete-plan.test.ts
   */

  import { describe, it, expect } from 'vitest'
  import { buildDeletePlan } from '../delete-plan'

  const USER_ID = '11111111-1111-1111-1111-111111111111'

  describe('buildDeletePlan', () => {
    it('returns 11 ordered statements', () => {
      const plan = buildDeletePlan(USER_ID)
      expect(plan).toHaveLength(11)
    })

    it('first statement nulls referred_by on anyone this user invited', () => {
      const plan = buildDeletePlan(USER_ID)
      expect(plan[0].sql).toMatch(/UPDATE\s+profiles/i)
      expect(plan[0].sql).toMatch(/SET\s+referred_by\s*=\s*NULL/i)
      expect(plan[0].sql).toMatch(/WHERE\s+referred_by\s*=\s*\$1/i)
      expect(plan[0].params).toEqual([USER_ID])
    })

    it('referred_by nulling precedes the profiles delete', () => {
      const plan = buildDeletePlan(USER_ID)
      const nullIdx = plan.findIndex(p => /SET\s+referred_by\s*=\s*NULL/i.test(p.sql))
      const profilesDeleteIdx = plan.findIndex(p =>
        /DELETE FROM\s+profiles/i.test(p.sql) && /WHERE\s+id\s*=\s*\$1/i.test(p.sql)
      )
      expect(nullIdx).toBeGreaterThanOrEqual(0)
      expect(profilesDeleteIdx).toBeGreaterThan(nullIdx)
    })

    it('deletes user-scoped child rows before profiles row', () => {
      const plan = buildDeletePlan(USER_ID)
      const profilesIdx = plan.findIndex(p =>
        /DELETE FROM\s+profiles/i.test(p.sql) && /WHERE\s+id\s*=\s*\$1/i.test(p.sql)
      )
      const childTables = [
        'user_badges',
        'user_bookmarks',
        'push_subscriptions',
        'match_ratings',
        'feature_interest',
        'user_activity_log',
      ]
      for (const t of childTables) {
        const idx = plan.findIndex(p => new RegExp(`DELETE FROM\\s+${t}`, 'i').test(p.sql))
        expect(idx, `${t} delete must exist`).toBeGreaterThanOrEqual(0)
        expect(idx, `${t} must be deleted before profiles`).toBeLessThan(profilesIdx)
      }
    })

    it('deletes Auth.js sessions and accounts before users', () => {
      const plan = buildDeletePlan(USER_ID)
      const sessionsIdx = plan.findIndex(p => /DELETE FROM\s+sessions/i.test(p.sql))
      const accountsIdx = plan.findIndex(p => /DELETE FROM\s+accounts/i.test(p.sql))
      const usersIdx = plan.findIndex(p =>
        /DELETE FROM\s+users/i.test(p.sql) && /WHERE\s+id\s*=\s*\$1/i.test(p.sql)
      )
      expect(sessionsIdx).toBeGreaterThanOrEqual(0)
      expect(accountsIdx).toBeGreaterThanOrEqual(0)
      expect(usersIdx).toBeGreaterThanOrEqual(0)
      expect(sessionsIdx).toBeLessThan(usersIdx)
      expect(accountsIdx).toBeLessThan(usersIdx)
    })

    it('every statement uses $1 parameterization bound to the user id', () => {
      const plan = buildDeletePlan(USER_ID)
      for (const stmt of plan) {
        expect(stmt.sql).toContain('$1')
        expect(stmt.params).toEqual([USER_ID])
      }
    })

    it('last statement deletes the Auth.js users row', () => {
      const plan = buildDeletePlan(USER_ID)
      const last = plan[plan.length - 1]
      expect(last.sql).toMatch(/DELETE FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i)
    })
  })
  ```

- [ ] **Step 2: Verify the test fails**

  ```bash
  npx vitest run src/lib/__tests__/delete-plan.test.ts
  ```

  Expected: test run fails with `Cannot find module '../delete-plan'` or similar. This proves the test is wired correctly.

- [ ] **Step 3: Write the implementation**

  Create `src/lib/delete-plan.ts`:

  ```ts
  // src/lib/delete-plan.ts
  // Pure function: given a user id, return the ordered list of parameterized
  // SQL statements that a DELETE /api/user/account transaction must execute.
  //
  // Design notes:
  // - Step 1 (nulling referred_by on anyone this user invited) runs FIRST,
  //   before any delete, so the self-referential FK on profiles.referred_by
  //   does not block downstream deletes even if the cascade is weakened later.
  // - Child-table deletes are explicit (not relying on ON DELETE CASCADE) so
  //   the delete trail is auditable. Several of these tables have cascade
  //   rules today; this plan still works if a future migration drops them.
  // - Steps 9–11 delete the Auth.js-owned rows (sessions, accounts, users)
  //   in an order that respects their FKs.
  // - The avatar_url on profiles points at Google's CDN for all regular
  //   users today — there is nothing to clean up in Supabase Storage.
  //   If Phase 2 adds user avatar upload, extend this plan accordingly.

  export interface DeleteStatement {
    sql: string
    params: [string]
  }

  export function buildDeletePlan(userId: string): DeleteStatement[] {
    return [
      // 1. Blank the inviter link on anyone this user referred (do not delete them).
      { sql: 'UPDATE profiles SET referred_by = NULL WHERE referred_by = $1', params: [userId] },

      // 2–7. Defensive explicit child deletes.
      { sql: 'DELETE FROM user_badges WHERE user_id = $1', params: [userId] },
      { sql: 'DELETE FROM user_bookmarks WHERE user_id = $1', params: [userId] },
      { sql: 'DELETE FROM push_subscriptions WHERE user_id = $1', params: [userId] },
      { sql: 'DELETE FROM match_ratings WHERE user_id = $1', params: [userId] },
      { sql: 'DELETE FROM feature_interest WHERE user_id = $1', params: [userId] },
      { sql: 'DELETE FROM user_activity_log WHERE user_id = $1', params: [userId] },

      // 8. Profile row.
      { sql: 'DELETE FROM profiles WHERE id = $1', params: [userId] },

      // 9–10. Auth.js child rows. Column names are quoted because the
      // @auth/pg-adapter schema uses camelCase identifiers.
      { sql: 'DELETE FROM sessions WHERE "userId" = $1', params: [userId] },
      { sql: 'DELETE FROM accounts WHERE "userId" = $1', params: [userId] },

      // 11. Auth.js users row. Last — FK targets from sessions/accounts.
      { sql: 'DELETE FROM users WHERE id = $1', params: [userId] },
    ]
  }
  ```

- [ ] **Step 4: Verify tests pass**

  ```bash
  npx vitest run src/lib/__tests__/delete-plan.test.ts
  ```

  Expected: 7 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/delete-plan.ts src/lib/__tests__/delete-plan.test.ts
  git commit -m "feat(lib): add buildDeletePlan pure helper for account deletion"
  ```

---

## Task 3: Pure helper — `export-bundle.ts` (tests first)

**Files:**
- Create: `src/lib/__tests__/export-bundle.test.ts`
- Create: `src/lib/export-bundle.ts`

- [ ] **Step 1: Write the failing test file**

  Create `src/lib/__tests__/export-bundle.test.ts`:

  ```ts
  /**
   * export-bundle.test.ts
   *
   * Unit tests for the pure user-data export bundle assembler.
   * Run with: npx vitest run src/lib/__tests__/export-bundle.test.ts
   */

  import { describe, it, expect } from 'vitest'
  import { assembleExportBundle, formatExportFilename } from '../export-bundle'

  const USER_ID = '11111111-1111-1111-1111-111111111111'
  const EXPORTED_AT = '2026-04-17T14:23:00.000Z'

  describe('assembleExportBundle', () => {
    it('returns an empty-but-valid bundle for a user with no data', () => {
      const bundle = assembleExportBundle({
        exportedAt: EXPORTED_AT,
        profile: {
          id: USER_ID,
          display_name: null,
          avatar_url: null,
          preferred_country: null,
          referral_code: null,
          referred_by: null,
          marketing_opt_in: false,
          created_at: '2026-04-01T00:00:00.000Z',
        },
        authUser: { email: null, emailVerified: null, name: null, image: null },
        accountProvider: null,
        bookmarks: [],
        pushSubscriptions: [],
        badges: [],
        ratings: [],
        invitedUserIds: [],
        featureInterest: [],
      })

      expect(bundle.exported_at).toBe(EXPORTED_AT)
      expect(bundle.profile.id).toBe(USER_ID)
      expect(bundle.bookmarks).toEqual([])
      expect(bundle.push_subscriptions).toEqual([])
      expect(bundle.badges).toEqual([])
      expect(bundle.ratings).toEqual([])
      expect(bundle.referrals).toEqual({ invited_by: null, invited: [] })
      expect(bundle.feature_interest).toEqual([])
    })

    it('redacts push subscription keys (p256dh, auth)', () => {
      const bundle = assembleExportBundle({
        exportedAt: EXPORTED_AT,
        profile: {
          id: USER_ID,
          display_name: 'Test',
          avatar_url: null,
          preferred_country: null,
          referral_code: null,
          referred_by: null,
          marketing_opt_in: false,
          created_at: '2026-04-01T00:00:00.000Z',
        },
        authUser: { email: 't@example.com', emailVerified: null, name: 'Test', image: null },
        accountProvider: 'google',
        bookmarks: [],
        pushSubscriptions: [
          {
            endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
            p256dh: 'SECRET-P256DH-KEY',
            auth: 'SECRET-AUTH-KEY',
            created_at: '2026-04-05T12:00:00.000Z',
          },
        ],
        badges: [],
        ratings: [],
        invitedUserIds: [],
        featureInterest: [],
      })

      expect(bundle.push_subscriptions).toHaveLength(1)
      expect(bundle.push_subscriptions[0]).toEqual({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        created_at: '2026-04-05T12:00:00.000Z',
      })
      const serialized = JSON.stringify(bundle)
      expect(serialized).not.toContain('SECRET-P256DH-KEY')
      expect(serialized).not.toContain('SECRET-AUTH-KEY')
    })

    it('falls back to auth.provider = "email" when there is no accounts row', () => {
      const bundle = assembleExportBundle({
        exportedAt: EXPORTED_AT,
        profile: {
          id: USER_ID,
          display_name: 'Test',
          avatar_url: null,
          preferred_country: null,
          referral_code: null,
          referred_by: null,
          marketing_opt_in: false,
          created_at: '2026-04-01T00:00:00.000Z',
        },
        authUser: { email: 't@example.com', emailVerified: null, name: 'Test', image: null },
        accountProvider: null,
        bookmarks: [],
        pushSubscriptions: [],
        badges: [],
        ratings: [],
        invitedUserIds: [],
        featureInterest: [],
      })
      expect(bundle.auth.provider).toBe('email')
    })

    it('passes through bookmarks, badges, ratings, and referrals unchanged', () => {
      const bundle = assembleExportBundle({
        exportedAt: EXPORTED_AT,
        profile: {
          id: USER_ID,
          display_name: 'Test',
          avatar_url: null,
          preferred_country: 'ES',
          referral_code: 'ABC123',
          referred_by: '22222222-2222-2222-2222-222222222222',
          marketing_opt_in: true,
          created_at: '2026-04-01T00:00:00.000Z',
        },
        authUser: {
          email: 't@example.com',
          emailVerified: '2026-04-01T00:05:00.000Z',
          name: 'Test',
          image: null,
        },
        accountProvider: 'google',
        bookmarks: [
          { bookmark_type: 'match', target_id: 'm1', created_at: '2026-04-02T00:00:00.000Z' },
          { bookmark_type: 'player', target_id: 'p1', created_at: '2026-04-03T00:00:00.000Z' },
        ],
        pushSubscriptions: [],
        badges: [
          { badge_id: 'welcome', tier: 1, earned_at: '2026-04-01T00:10:00.000Z' },
        ],
        ratings: [
          { match_id: 'm1', rating: 4, created_at: '2026-04-04T00:00:00.000Z' },
        ],
        invitedUserIds: ['33333333-3333-3333-3333-333333333333'],
        featureInterest: [
          { feature: 'genius', created_at: '2026-04-05T00:00:00.000Z' },
        ],
      })

      expect(bundle.bookmarks).toHaveLength(2)
      expect(bundle.bookmarks[0]).toEqual({
        bookmark_type: 'match',
        target_id: 'm1',
        created_at: '2026-04-02T00:00:00.000Z',
      })
      expect(bundle.badges[0]).toEqual({
        badge_id: 'welcome',
        tier: 1,
        earned_at: '2026-04-01T00:10:00.000Z',
      })
      expect(bundle.ratings[0]).toEqual({
        match_id: 'm1',
        rating: 4,
        created_at: '2026-04-04T00:00:00.000Z',
      })
      expect(bundle.referrals.invited_by).toBe('22222222-2222-2222-2222-222222222222')
      expect(bundle.referrals.invited).toEqual(['33333333-3333-3333-3333-333333333333'])
      expect(bundle.auth.provider).toBe('google')
      expect(bundle.auth.email_verified).toBe('2026-04-01T00:05:00.000Z')
      expect(bundle.profile.marketing_opt_in).toBe(true)
    })
  })

  describe('formatExportFilename', () => {
    it('formats YYYY-MM-DD from an ISO string in UTC', () => {
      expect(formatExportFilename('2026-04-17T14:23:00.000Z')).toBe(
        'padelnachos-export-2026-04-17.json'
      )
    })

    it('uses UTC date even when the timestamp is close to midnight local', () => {
      // 2026-04-17T23:59Z is still the 17th in UTC regardless of local tz.
      expect(formatExportFilename('2026-04-17T23:59:00.000Z')).toBe(
        'padelnachos-export-2026-04-17.json'
      )
    })
  })
  ```

- [ ] **Step 2: Verify the test fails**

  ```bash
  npx vitest run src/lib/__tests__/export-bundle.test.ts
  ```

  Expected: fails with `Cannot find module '../export-bundle'`.

- [ ] **Step 3: Write the implementation**

  Create `src/lib/export-bundle.ts`:

  ```ts
  // src/lib/export-bundle.ts
  // Pure assembler for GET /api/user/export. Takes already-fetched rows and
  // returns the final JSON bundle shape. Keeping this pure lets us unit-test
  // the redaction and shape without needing a DB.

  export interface ExportProfileRow {
    id: string
    display_name: string | null
    avatar_url: string | null
    preferred_country: string | null
    referral_code: string | null
    referred_by: string | null
    marketing_opt_in: boolean
    created_at: string
  }

  export interface ExportAuthUserRow {
    email: string | null
    emailVerified: string | null
    name: string | null
    image: string | null
  }

  export interface ExportPushSubscriptionRow {
    endpoint: string
    p256dh: string | null
    auth: string | null
    created_at: string
  }

  export interface ExportBookmarkRow {
    bookmark_type: 'match' | 'player'
    target_id: string
    created_at: string
  }

  export interface ExportBadgeRow {
    badge_id: string
    tier: number
    earned_at: string
  }

  export interface ExportRatingRow {
    match_id: string
    rating: number
    created_at: string
  }

  export interface ExportFeatureInterestRow {
    feature: string
    created_at: string
  }

  export interface AssembleInput {
    exportedAt: string
    profile: ExportProfileRow
    authUser: ExportAuthUserRow
    accountProvider: string | null
    bookmarks: ExportBookmarkRow[]
    pushSubscriptions: ExportPushSubscriptionRow[]
    badges: ExportBadgeRow[]
    ratings: ExportRatingRow[]
    invitedUserIds: string[]
    featureInterest: ExportFeatureInterestRow[]
  }

  export interface UserExportBundle {
    exported_at: string
    profile: ExportProfileRow
    auth: {
      email: string | null
      provider: string
      email_verified: string | null
      name: string | null
      image: string | null
    }
    bookmarks: ExportBookmarkRow[]
    push_subscriptions: Array<{ endpoint: string; created_at: string }>
    badges: ExportBadgeRow[]
    ratings: ExportRatingRow[]
    referrals: { invited_by: string | null; invited: string[] }
    feature_interest: ExportFeatureInterestRow[]
  }

  export function assembleExportBundle(input: AssembleInput): UserExportBundle {
    return {
      exported_at: input.exportedAt,
      profile: input.profile,
      auth: {
        email: input.authUser.email,
        // No accounts row means this user only signed in via email magic link.
        provider: input.accountProvider ?? 'email',
        email_verified: input.authUser.emailVerified,
        name: input.authUser.name,
        image: input.authUser.image,
      },
      bookmarks: input.bookmarks,
      // Redact p256dh + auth keys — they grant push-send capability and have
      // no legitimate export use.
      push_subscriptions: input.pushSubscriptions.map(({ endpoint, created_at }) => ({
        endpoint,
        created_at,
      })),
      badges: input.badges,
      ratings: input.ratings,
      referrals: {
        invited_by: input.profile.referred_by,
        invited: input.invitedUserIds,
      },
      feature_interest: input.featureInterest,
    }
  }

  export function formatExportFilename(isoTimestamp: string): string {
    // UTC YYYY-MM-DD is authoritative regardless of server tz.
    const d = new Date(isoTimestamp)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `padelnachos-export-${y}-${m}-${day}.json`
  }
  ```

- [ ] **Step 4: Verify tests pass**

  ```bash
  npx vitest run src/lib/__tests__/export-bundle.test.ts
  ```

  Expected: 6 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/export-bundle.ts src/lib/__tests__/export-bundle.test.ts
  git commit -m "feat(lib): add assembleExportBundle pure helper for user data export"
  ```

---

## Task 4: Shared `pg.ts` pool factory

**Files:**
- Create: `src/lib/pg.ts`

- [ ] **Step 1: Write the factory**

  Create `src/lib/pg.ts`:

  ```ts
  // src/lib/pg.ts
  // Shared pg.Pool factory for API routes that need transactional Postgres
  // access (e.g. DELETE /api/user/account). We construct a fresh pool per
  // call site to avoid a circular import with src/auth.ts, which exports
  // Auth.js handlers. In Vercel serverless, each function instance gets its
  // own pool anyway, so there is no connection-reuse benefit to sharing.

  import { Pool } from 'pg'

  function parseDbUrl(url: string) {
    const u = new URL(url)
    return {
      host: u.hostname,
      port: parseInt(u.port || '5432', 10),
      database: u.pathname.slice(1) || 'postgres',
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    }
  }

  export function createPool(): Pool {
    return new Pool({
      ...parseDbUrl(process.env.DATABASE_URL ?? ''),
      max: 1,
      ssl: { rejectUnauthorized: false },
    })
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/pg.ts
  git commit -m "feat(lib): add createPool helper for transactional routes"
  ```

---

## Task 5: `DELETE /api/user/account` endpoint

**Files:**
- Create: `src/app/api/user/account/types.ts`
- Create: `src/app/api/user/account/route.ts`

- [ ] **Step 1: Write the types file**

  Create `src/app/api/user/account/types.ts`:

  ```ts
  // src/app/api/user/account/types.ts
  // Response types for DELETE /api/user/account.
  // Success path is HTTP 204 No Content with no body.

  export type AccountDeleteErrorResponse = { error: string }
  ```

- [ ] **Step 2: Write the route**

  Create `src/app/api/user/account/route.ts`:

  ```ts
  // src/app/api/user/account/route.ts
  // DELETE — permanently removes the authenticated user.
  // Runs buildDeletePlan() inside a single BEGIN/COMMIT transaction via pg.
  // Auth is validated BEFORE any DB access via getUserOrFail().

  import { getUserOrFail } from '../_auth'
  import { buildDeletePlan } from '@/lib/delete-plan'
  import { createPool } from '@/lib/pg'

  export async function DELETE() {
    const { user, error } = await getUserOrFail()
    if (error) return error

    const pool = createPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const stmt of buildDeletePlan(user.id)) {
        await client.query(stmt.sql, stmt.params)
      }
      await client.query('COMMIT')
    } catch (e) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // ignore rollback failure — original error is more interesting
      }
      const message = e instanceof Error ? e.message : 'account delete failed'
      return Response.json({ error: message }, { status: 500 })
    } finally {
      client.release()
      await pool.end().catch(() => {})
    }

    return new Response(null, { status: 204 })
  }
  ```

- [ ] **Step 3: Type-check and lint**

  ```bash
  npx tsc --noEmit && npm run lint -- src/app/api/user/account/
  ```

  Expected: both exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/api/user/account/
  git commit -m "feat(api): DELETE /api/user/account with transactional delete plan"
  ```

---

## Task 6: `GET /api/user/export` endpoint

**Files:**
- Create: `src/app/api/user/export/types.ts`
- Create: `src/app/api/user/export/route.ts`

- [ ] **Step 1: Write the types file**

  Create `src/app/api/user/export/types.ts`:

  ```ts
  // src/app/api/user/export/types.ts
  // Re-exports the bundle type from the pure helper so API consumers can
  // import it without reaching into src/lib/.

  export type { UserExportBundle } from '@/lib/export-bundle'
  ```

- [ ] **Step 2: Write the route**

  Create `src/app/api/user/export/route.ts`:

  ```ts
  // src/app/api/user/export/route.ts
  // GET — returns a JSON file attachment with everything we hold about the
  // authenticated user. Assembles in-memory; no streaming (payload is small).
  //
  // Scoping discipline: every query below is bound by user_id = $userId or
  // id = $userId so this endpoint can never leak another user's rows.

  import { getUserOrFail } from '../_auth'
  import {
    assembleExportBundle,
    formatExportFilename,
    type ExportBookmarkRow,
    type ExportBadgeRow,
    type ExportRatingRow,
    type ExportPushSubscriptionRow,
    type ExportFeatureInterestRow,
  } from '@/lib/export-bundle'

  export async function GET() {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    try {
      const [
        profileRes,
        authUserRes,
        accountRes,
        bookmarksRes,
        pushRes,
        badgesRes,
        ratingsRes,
        invitedRes,
        featureRes,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select(
            'id, display_name, avatar_url, preferred_country, referral_code, referred_by, marketing_opt_in, created_at'
          )
          .eq('id', user.id)
          .single(),
        supabase.from('users').select('email, "emailVerified", name, image').eq('id', user.id).single(),
        supabase.from('accounts').select('provider').eq('userId', user.id).limit(1).maybeSingle(),
        supabase
          .from('user_bookmarks')
          .select('bookmark_type, target_id, created_at')
          .eq('user_id', user.id),
        supabase
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth, created_at')
          .eq('user_id', user.id),
        supabase
          .from('user_badges')
          .select('badge_id, tier, earned_at')
          .eq('user_id', user.id),
        supabase
          .from('match_ratings')
          .select('match_id, rating, created_at')
          .eq('user_id', user.id),
        supabase.from('profiles').select('id').eq('referred_by', user.id),
        supabase
          .from('feature_interest')
          .select('feature, created_at')
          .eq('user_id', user.id),
      ])

      if (profileRes.error) throw profileRes.error
      if (authUserRes.error) throw authUserRes.error

      const exportedAt = new Date().toISOString()
      const bundle = assembleExportBundle({
        exportedAt,
        profile: profileRes.data,
        authUser: authUserRes.data,
        accountProvider: accountRes.data?.provider ?? null,
        bookmarks: (bookmarksRes.data ?? []) as ExportBookmarkRow[],
        pushSubscriptions: (pushRes.data ?? []) as ExportPushSubscriptionRow[],
        badges: (badgesRes.data ?? []) as ExportBadgeRow[],
        ratings: (ratingsRes.data ?? []) as ExportRatingRow[],
        invitedUserIds: (invitedRes.data ?? []).map((r: { id: string }) => r.id),
        featureInterest: (featureRes.data ?? []) as ExportFeatureInterestRow[],
      })

      return new Response(JSON.stringify(bundle, null, 2), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${formatExportFilename(exportedAt)}"`,
        },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'export failed'
      return Response.json({ error: message }, { status: 500 })
    }
  }
  ```

- [ ] **Step 3: Type-check and lint**

  ```bash
  npx tsc --noEmit && npm run lint -- src/app/api/user/export/
  ```

  Expected: both exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/api/user/export/
  git commit -m "feat(api): GET /api/user/export returns downloadable JSON bundle"
  ```

---

## Task 7: `PATCH /api/user/marketing-prefs` endpoint

**Files:**
- Create: `src/app/api/user/marketing-prefs/types.ts`
- Create: `src/app/api/user/marketing-prefs/route.ts`

- [ ] **Step 1: Write the types file**

  Create `src/app/api/user/marketing-prefs/types.ts`:

  ```ts
  // src/app/api/user/marketing-prefs/types.ts

  export type MarketingPrefsRequest = { optIn: boolean }

  export type MarketingPrefsResponse =
    | { ok: true; marketing_opt_in: boolean }
    | { error: string }
  ```

- [ ] **Step 2: Write the route**

  Create `src/app/api/user/marketing-prefs/route.ts`:

  ```ts
  // src/app/api/user/marketing-prefs/route.ts
  // PATCH — updates profiles.marketing_opt_in for the authenticated user.

  import { getUserOrFail } from '../_auth'

  export async function PATCH(req: Request) {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: 'Invalid optIn' }, { status: 400 })
    }

    const optIn = (body as { optIn?: unknown })?.optIn
    if (typeof optIn !== 'boolean') {
      return Response.json({ error: 'Invalid optIn' }, { status: 400 })
    }

    const { data, error: dbErr } = await supabase
      .from('profiles')
      .update({ marketing_opt_in: optIn })
      .eq('id', user.id)
      .select('marketing_opt_in')
      .single()

    if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

    return Response.json({ ok: true, marketing_opt_in: data.marketing_opt_in })
  }
  ```

- [ ] **Step 3: Type-check and lint**

  ```bash
  npx tsc --noEmit && npm run lint -- src/app/api/user/marketing-prefs/
  ```

  Expected: both exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/api/user/marketing-prefs/
  git commit -m "feat(api): PATCH /api/user/marketing-prefs writes consent flag"
  ```

---

## Task 8: Extend `/api/user/profile` GET + PATCH for `marketing_opt_in`

**Files:**
- Modify: `src/app/api/user/profile/route.ts`

- [ ] **Step 1: Replace the existing route file**

  The current file selects/patches only four fields. We add `marketing_opt_in` to both the GET select list and the PATCH allowlist. Replace the entire contents of `src/app/api/user/profile/route.ts` with:

  ```ts
  import { getUserOrFail } from '../_auth'

  const SELECT_COLUMNS = 'id, display_name, avatar_url, preferred_country, marketing_opt_in'
  const ALLOWED_KEYS = ['display_name', 'avatar_url', 'preferred_country', 'marketing_opt_in']

  export async function GET() {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    const { data } = await supabase
      .from('profiles')
      .select(SELECT_COLUMNS)
      .eq('id', user.id)
      .single()

    return Response.json(data)
  }

  export async function PATCH(req: Request) {
    const { user, supabase, error } = await getUserOrFail()
    if (error) return error

    const body = await req.json()
    const updates: Record<string, unknown> = {}
    for (const key of ALLOWED_KEYS) {
      if (key in body) updates[key] = body[key]
    }

    const { data, error: dbErr } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select(SELECT_COLUMNS)
      .single()

    if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
    return Response.json(data)
  }
  ```

- [ ] **Step 2: Type-check and lint**

  ```bash
  npx tsc --noEmit && npm run lint -- src/app/api/user/profile/
  ```

  Expected: both exit 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/api/user/profile/route.ts
  git commit -m "feat(api): expose marketing_opt_in on user profile GET/PATCH"
  ```

---

## Task 9: `<GatedAnalytics>` client component + layout swap

**Files:**
- Create: `src/components/GatedAnalytics.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the gated component**

  Create `src/components/GatedAnalytics.tsx`:

  ```tsx
  'use client'
  // src/components/GatedAnalytics.tsx
  // Renders <Analytics /> from @vercel/analytics/react only when the user has
  // NOT opted out. Opt-out state lives in localStorage under the key
  // `pn_analytics_opt_out` — value `'1'` means opted out, anything else
  // (including absent) means opted in. See spec §2.4 for rationale.
  //
  // Important: initial useState(true) means NO tracker on the first client
  // render. After the effect reads localStorage, we flip to the real value.
  // Server-rendered HTML never contains tracker markup, so there's no
  // hydration mismatch either way.

  import { useEffect, useState } from 'react'
  import { Analytics } from '@vercel/analytics/react'

  export function GatedAnalytics() {
    const [optOut, setOptOut] = useState(true)
    useEffect(() => {
      setOptOut(localStorage.getItem('pn_analytics_opt_out') === '1')
    }, [])
    if (optOut) return null
    return <Analytics />
  }
  ```

- [ ] **Step 2: Swap the layout import + element**

  In `src/app/layout.tsx`, replace the `@vercel/analytics/react` import and the `<Analytics />` usage. Apply two edits:

  Replace:
  ```tsx
  import { Analytics } from "@vercel/analytics/react";
  ```
  with:
  ```tsx
  import { GatedAnalytics } from "@/components/GatedAnalytics";
  ```

  Replace:
  ```tsx
          <Analytics />
  ```
  with:
  ```tsx
          <GatedAnalytics />
  ```

- [ ] **Step 3: Build and verify**

  ```bash
  npm run build
  ```

  Expected: build succeeds. No TS errors referencing `Analytics`.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/GatedAnalytics.tsx src/app/layout.tsx
  git commit -m "refactor(analytics): gate Vercel Analytics behind localStorage opt-out"
  ```

---

## Task 10: Add the `settings` namespace to `src/messages/en.json`

**Files:**
- Modify: `src/messages/en.json`

- [ ] **Step 1: Insert the new namespace after the `profile` namespace**

  Locate this block in `src/messages/en.json`:

  ```json
    "profile": {
      "profile": "Profile",
      "signOut": "Sign out",
      "signIn": "Sign in",
      "achievements": "Achievements",
      "bookmarks": "Bookmarks",
      "following": "Following",
      "loading": "Loading your profile...",
      "language": "Language"
    },
  ```

  Immediately after it (before `"badges": {`), insert:

  ```json
    "settings": {
      "title": "Settings",
      "sections": {
        "account": "Account",
        "preferences": "Preferences",
        "privacy": "Privacy & data",
        "support": "Support"
      },
      "account": {
        "displayName": "Display name",
        "email": "Email",
        "activeSessions": "Active sessions",
        "comingSoon": "Coming soon",
        "editName": {
          "title": "Edit display name",
          "placeholder": "Your name",
          "save": "Save",
          "cancel": "Cancel",
          "savedToast": "Name updated"
        }
      },
      "preferences": {
        "language": "Language",
        "region": "Region",
        "regionHint": "Used to show local broadcasters and content.",
        "push": "Push notifications",
        "pushHint": "Get notified when bookmarked matches go live"
      },
      "privacy": {
        "policy": "Privacy policy",
        "terms": "Terms of service",
        "analytics": "Share anonymous usage data",
        "analyticsHint": "Help improve PadelNachos. Toggle off to opt out.",
        "marketing": "Marketing emails",
        "marketingHint": "Occasional updates about new features and tournaments.",
        "exportData": "Download my data",
        "exportDataHint": "Get a JSON file of everything we have about you.",
        "deleteAccount": "Delete my account",
        "deleteAccountHint": "Permanently remove your account and data."
      },
      "support": {
        "contact": "Contact support",
        "about": "About PadelNachos"
      },
      "signOut": "Sign out",
      "deleteModal": {
        "title": "Delete your account?",
        "body": "This permanently removes your profile, bookmarks, badges, ratings, and sign-in methods. This cannot be undone.",
        "continue": "Continue",
        "cancel": "Cancel",
        "confirmPrompt": "Type DELETE to confirm",
        "confirmWord": "DELETE",
        "confirmButton": "Delete forever",
        "errorGeneric": "Could not delete account. Please try again or contact support."
      }
    },
  ```

- [ ] **Step 2: Validate JSON**

  ```bash
  node -e "JSON.parse(require('fs').readFileSync('src/messages/en.json','utf8'))" && echo OK
  ```

  Expected: prints `OK`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/messages/en.json
  git commit -m "feat(i18n): add settings namespace (English)"
  ```

---

## Task 11: Gear icon on `/profile` header

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

- [ ] **Step 1: Replace the 36×36 empty spacer with a gear icon link**

  In `src/app/[locale]/(app)/profile/page.tsx`, find this line (currently at the right end of the header block):

  ```tsx
          <div style={{ width: 36 }} />
  ```

  Replace it with:

  ```tsx
          <Link
            href="/profile/settings"
            aria-label="Settings"
            style={{
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: V3.MUTED, textDecoration: 'none',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
  ```

  `Link` is already imported from `@/i18n/navigation` at the top of the file (line 7); no new import needed.

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/[locale]/(app)/profile/page.tsx
  git commit -m "feat(profile): add gear icon linking to /profile/settings"
  ```

---

## Task 12: `<EditNameSheet>` component

**Files:**
- Create: `src/app/[locale]/(app)/profile/settings/EditNameSheet.tsx`

- [ ] **Step 1: Create the sheet component**

  Create `src/app/[locale]/(app)/profile/settings/EditNameSheet.tsx`:

  ```tsx
  'use client'
  // src/app/[locale]/(app)/profile/settings/EditNameSheet.tsx
  // Bottom sheet for editing profiles.display_name. Calls PATCH /api/user/profile.

  import { useEffect, useState } from 'react'
  import { useTranslations } from 'next-intl'

  const V3 = {
    GREEN: '#7ED321',
    ORANGE: '#F5A623',
    LIVE_RED: '#FF4655',
    BG_CARD: '#141414',
    MUTED: '#6B7280',
    BORDER: 'rgba(255,255,255,0.06)',
  } as const

  const MAX_LEN = 40

  interface Props {
    open: boolean
    initialName: string
    onClose: () => void
    onSaved: (newName: string) => void
  }

  export function EditNameSheet({ open, initialName, onClose, onSaved }: Props) {
    const t = useTranslations('settings.account.editName')
    const [value, setValue] = useState(initialName)
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
      if (open) {
        setValue(initialName)
        setErr(null)
      }
    }, [open, initialName])

    if (!open) return null

    const trimmed = value.trim()
    const dirty = trimmed !== initialName.trim()
    const canSave = dirty && trimmed.length > 0 && !saving

    async function save() {
      setSaving(true)
      setErr(null)
      try {
        const res = await fetch('/api/user/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ display_name: trimmed }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'save failed')
        }
        onSaved(trimmed)
        onClose()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'save failed')
      } finally {
        setSaving(false)
      }
    }

    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}
        onClick={onClose}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 500,
            background: V3.BG_CARD,
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            padding: 20,
            borderTop: `1px solid ${V3.BORDER}`,
          }}
        >
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginBottom: 14 }}>
            {t('title')}
          </div>
          <input
            type="text"
            value={value}
            onChange={e => setValue(e.target.value.slice(0, MAX_LEN))}
            placeholder={t('placeholder')}
            autoFocus
            style={{
              width: '100%', padding: '12px 14px',
              background: '#0A0A0A', color: '#fff',
              border: `1px solid ${V3.BORDER}`, borderRadius: 8,
              fontSize: 14, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          {err && (
            <div style={{ color: V3.LIVE_RED, fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              onClick={onClose}
              disabled={saving}
              style={{
                flex: 1, padding: 12, borderRadius: 8,
                background: 'transparent', color: V3.MUTED,
                border: `1px solid ${V3.BORDER}`, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              }}
            >
              {t('cancel')}
            </button>
            <button
              onClick={save}
              disabled={!canSave}
              style={{
                flex: 1, padding: 12, borderRadius: 8,
                background: canSave ? V3.GREEN : '#333',
                color: canSave ? '#000' : V3.MUTED,
                border: 'none', cursor: canSave ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              {t('save')}
            </button>
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add "src/app/[locale]/(app)/profile/settings/EditNameSheet.tsx"
  git commit -m "feat(profile): add EditNameSheet for display name edits"
  ```

---

## Task 13: `<DeleteAccountModal>` component

**Files:**
- Create: `src/app/[locale]/(app)/profile/settings/DeleteAccountModal.tsx`

- [ ] **Step 1: Create the modal**

  Create `src/app/[locale]/(app)/profile/settings/DeleteAccountModal.tsx`:

  ```tsx
  'use client'
  // src/app/[locale]/(app)/profile/settings/DeleteAccountModal.tsx
  // Two-step confirmation modal. Step 1 is the warning; step 2 reveals a
  // text input that must match the localized confirm word (default "DELETE")
  // before the final destructive button is enabled.

  import { useState } from 'react'
  import { useTranslations } from 'next-intl'
  import { signOut } from 'next-auth/react'
  import { useRouter } from '@/i18n/navigation'

  const V3 = {
    LIVE_RED: '#FF4655',
    BG_CARD: '#141414',
    MUTED: '#6B7280',
    BORDER: 'rgba(255,255,255,0.06)',
  } as const

  interface Props {
    open: boolean
    onClose: () => void
  }

  export function DeleteAccountModal({ open, onClose }: Props) {
    const t = useTranslations('settings.deleteModal')
    const confirmWord = t('confirmWord')
    const [step, setStep] = useState<1 | 2>(1)
    const [typed, setTyped] = useState('')
    const [deleting, setDeleting] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const router = useRouter()

    if (!open) return null

    const canDelete = step === 2 && typed.trim() === confirmWord && !deleting

    async function doDelete() {
      setDeleting(true)
      setErr(null)
      try {
        const res = await fetch('/api/user/account', { method: 'DELETE' })
        if (res.status !== 204) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? t('errorGeneric'))
        }
        await signOut({ redirect: false })
        router.push('/home?deleted=1')
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('errorGeneric'))
        setDeleting(false)
      }
    }

    function reset() {
      setStep(1)
      setTyped('')
      setErr(null)
      onClose()
    }

    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}
        onClick={reset}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 420,
            background: V3.BG_CARD,
            borderRadius: 12, padding: 24,
            border: `1px solid ${V3.BORDER}`,
          }}
        >
          <div style={{
            color: V3.LIVE_RED, fontSize: 16, fontWeight: 700,
            marginBottom: 10,
          }}>
            {t('title')}
          </div>
          <div style={{ color: '#D1D5DB', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
            {t('body')}
          </div>
          {step === 2 && (
            <>
              <div style={{ color: V3.MUTED, fontSize: 12, marginBottom: 6 }}>
                {t('confirmPrompt')}
              </div>
              <input
                type="text"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                autoFocus
                autoCapitalize="characters"
                style={{
                  width: '100%', padding: '10px 12px',
                  background: '#0A0A0A', color: '#fff',
                  border: `1px solid ${V3.BORDER}`, borderRadius: 8,
                  fontSize: 14, outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </>
          )}
          {err && (
            <div style={{ color: V3.LIVE_RED, fontSize: 12, marginTop: 10 }}>
              {err}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              onClick={reset}
              disabled={deleting}
              style={{
                flex: 1, padding: 12, borderRadius: 8,
                background: 'transparent', color: V3.MUTED,
                border: `1px solid ${V3.BORDER}`, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              }}
            >
              {t('cancel')}
            </button>
            {step === 1 ? (
              <button
                onClick={() => setStep(2)}
                style={{
                  flex: 1, padding: 12, borderRadius: 8,
                  background: V3.LIVE_RED, color: '#fff',
                  border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                }}
              >
                {t('continue')}
              </button>
            ) : (
              <button
                onClick={doDelete}
                disabled={!canDelete}
                style={{
                  flex: 1, padding: 12, borderRadius: 8,
                  background: canDelete ? V3.LIVE_RED : '#4B1A1E',
                  color: canDelete ? '#fff' : V3.MUTED,
                  border: 'none',
                  cursor: canDelete ? 'pointer' : 'not-allowed',
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                }}
              >
                {t('confirmButton')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add "src/app/[locale]/(app)/profile/settings/DeleteAccountModal.tsx"
  git commit -m "feat(profile): add DeleteAccountModal with two-step confirmation"
  ```

---

## Task 14: Settings page (`/profile/settings`)

**Files:**
- Create: `src/app/[locale]/(app)/profile/settings/page.tsx`

- [ ] **Step 1: Create the page**

  Create `src/app/[locale]/(app)/profile/settings/page.tsx`:

  ```tsx
  'use client'
  // src/app/[locale]/(app)/profile/settings/page.tsx
  // Settings — the canonical home for account, preferences, privacy, and support
  // controls. V3 styling, 500px max-width, five ordered sections per spec §2.

  import { useEffect, useState } from 'react'
  import { useTranslations } from 'next-intl'
  import { signOut as nextAuthSignOut } from 'next-auth/react'
  import { useRouter, Link } from '@/i18n/navigation'
  import { useAuth } from '@/components/AuthProvider'
  import { supabase } from '@/lib/supabase'
  import { usePushNotifications } from '@/hooks/usePushNotifications'
  import CountryPicker from '@/components/CountryPicker'
  import LocaleSwitcher from '@/components/LocaleSwitcher'
  import { EditNameSheet } from './EditNameSheet'
  import { DeleteAccountModal } from './DeleteAccountModal'

  const V3 = {
    GREEN: '#7ED321',
    ORANGE: '#F5A623',
    LIVE_RED: '#FF4655',
    BG_BASE: '#1A1A1A',
    BG_CARD: '#141414',
    MUTED: '#6B7280',
    BORDER: 'rgba(255,255,255,0.06)',
    clip: { button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)' },
  } as const

  interface ProfileRow {
    id: string
    display_name: string | null
    avatar_url: string | null
    preferred_country: string | null
    marketing_opt_in: boolean
  }

  interface CountryOption {
    iso2: string
    name: string
  }

  function SectionHeader({ label }: { label: string }) {
    return (
      <div style={{
        color: V3.ORANGE, fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 1,
        padding: '18px 16px 8px',
      }}>
        {label}
      </div>
    )
  }

  function Row({
    label,
    hint,
    control,
    onClick,
    destructive,
    disabled,
  }: {
    label: string
    hint?: string
    control?: React.ReactNode
    onClick?: () => void
    destructive?: boolean
    disabled?: boolean
  }) {
    const content = (
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px',
          borderBottom: `1px solid ${V3.BORDER}`,
          background: 'transparent',
          opacity: disabled ? 0.5 : 1,
          cursor: onClick && !disabled ? 'pointer' : 'default',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: destructive ? V3.LIVE_RED : '#fff',
            fontSize: 14, fontWeight: 500,
          }}>
            {label}
          </div>
          {hint && (
            <div style={{ color: V3.MUTED, fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
              {hint}
            </div>
          )}
        </div>
        {control}
      </div>
    )

    if (onClick && !disabled) {
      return (
        <button
          onClick={onClick}
          style={{
            width: '100%', display: 'block', background: 'transparent',
            border: 'none', padding: 0, textAlign: 'left', fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          {content}
        </button>
      )
    }
    return content
  }

  function Chevron({ destructive }: { destructive?: boolean }) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke={destructive ? V3.LIVE_RED : V3.MUTED}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
      </svg>
    )
  }

  function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
    return (
      <button
        role="switch"
        aria-checked={checked}
        onClick={e => { e.stopPropagation(); if (!disabled) onChange(!checked) }}
        disabled={disabled}
        style={{
          width: 44, height: 24, borderRadius: 12,
          background: checked ? V3.GREEN : '#333',
          border: 'none', padding: 0, position: 'relative',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 120ms',
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          background: '#fff', position: 'absolute',
          top: 2, left: checked ? 22 : 2,
          transition: 'left 120ms',
        }} />
      </button>
    )
  }

  export default function SettingsPage() {
    const t = useTranslations('settings')
    const { user, loading: authLoading } = useAuth()
    const router = useRouter()
    const { enabled: pushEnabled, toggle: togglePush } = usePushNotifications()

    const [profile, setProfile] = useState<ProfileRow | null>(null)
    const [countryOptions, setCountryOptions] = useState<CountryOption[]>([])
    const [countryDraft, setCountryDraft] = useState<string>('')
    const [savingCountry, setSavingCountry] = useState(false)

    const [analyticsOptOut, setAnalyticsOptOut] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [toast, setToast] = useState<string | null>(null)

    // Redirect unauthenticated users to /home.
    useEffect(() => {
      if (!authLoading && !user) {
        router.replace('/home')
      }
    }, [authLoading, user, router])

    // Load profile + country options.
    useEffect(() => {
      if (!user) return
      let cancelled = false
      ;(async () => {
        const [{ data: p }, { data: c }] = await Promise.all([
          fetch('/api/user/profile').then(r => r.json()) as Promise<{ data?: ProfileRow } | ProfileRow>,
          supabase.from('broadcasters').select('country_iso2, country_name').not('country_iso2', 'is', null),
        ] as const)
        if (cancelled) return
        const row = (p as ProfileRow) ?? null
        setProfile(row)
        setCountryDraft(row?.preferred_country ?? '')
        const seen = new Set<string>()
        const opts: CountryOption[] = []
        for (const r of (c ?? []) as Array<{ country_iso2: string | null; country_name: string | null }>) {
          const iso = (r.country_iso2 ?? '').toUpperCase()
          if (!iso || seen.has(iso)) continue
          seen.add(iso)
          opts.push({ iso2: iso, name: r.country_name ?? iso })
        }
        opts.sort((a, b) => a.name.localeCompare(b.name))
        setCountryOptions(opts)
      })()
      return () => { cancelled = true }
    }, [user])

    // Read the analytics opt-out flag from localStorage on mount.
    useEffect(() => {
      setAnalyticsOptOut(localStorage.getItem('pn_analytics_opt_out') === '1')
    }, [])

    // Auto-dismiss toasts.
    useEffect(() => {
      if (!toast) return
      const id = setTimeout(() => setToast(null), 2200)
      return () => clearTimeout(id)
    }, [toast])

    async function saveCountry(next: string) {
      setCountryDraft(next)
      setSavingCountry(true)
      try {
        await fetch('/api/user/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preferred_country: next || null }),
        })
      } finally {
        setSavingCountry(false)
      }
    }

    function toggleAnalytics(next: boolean) {
      // "next=true" here means "share data" (opt IN). Flip the localStorage key.
      const optOut = !next
      setAnalyticsOptOut(optOut)
      if (optOut) {
        localStorage.setItem('pn_analytics_opt_out', '1')
      } else {
        localStorage.removeItem('pn_analytics_opt_out')
      }
    }

    async function toggleMarketing(next: boolean) {
      if (!profile) return
      // Optimistic.
      const prev = profile.marketing_opt_in
      setProfile({ ...profile, marketing_opt_in: next })
      try {
        const res = await fetch('/api/user/marketing-prefs', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ optIn: next }),
        })
        if (!res.ok) throw new Error('marketing prefs failed')
      } catch {
        setProfile({ ...profile, marketing_opt_in: prev })
      }
    }

    async function downloadExport() {
      const res = await fetch('/api/user/export')
      if (!res.ok) return
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') ?? ''
      const match = cd.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? 'padelnachos-export.json'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }

    async function handleSignOut() {
      await nextAuthSignOut({ redirect: false })
      router.push('/home')
    }

    if (authLoading || !user || !profile) {
      return (
        <div style={{ background: V3.BG_BASE, minHeight: '100dvh', color: V3.MUTED,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
          Loading…
        </div>
      )
    }

    const providerTag = user.email?.includes('@gmail.') ? 'Google' : 'Email'

    return (
      <div style={{ maxWidth: 500, margin: '0 auto', paddingBottom: 80, background: V3.BG_BASE, minHeight: '100dvh' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
          position: 'sticky', top: 0, zIndex: 10,
          background: '#0A0A0A',
          height: 62,
        }}>
          <button
            onClick={() => { if (window.history.length > 1) router.back(); else router.push('/profile') }}
            style={{
              width: 36, height: 36, border: 'none', cursor: 'pointer',
              background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: V3.MUTED,
            }}
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
            {t('title')}
          </div>
          <div style={{ width: 36 }} />
        </div>

        {/* ACCOUNT */}
        <SectionHeader label={t('sections.account')} />
        <Row
          label={t('account.displayName')}
          hint={profile.display_name ?? ''}
          control={<Chevron />}
          onClick={() => setEditOpen(true)}
        />
        <Row
          label={t('account.email')}
          hint={`${user.email ?? ''} · ${providerTag}`}
        />
        <Row
          label={t('account.activeSessions')}
          disabled
          control={
            <span style={{
              fontSize: 10, fontWeight: 700, color: V3.MUTED,
              background: 'rgba(255,255,255,0.05)',
              padding: '3px 8px', borderRadius: 10,
            }}>
              {t('account.comingSoon')}
            </span>
          }
        />

        {/* PREFERENCES */}
        <SectionHeader label={t('sections.preferences')} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', borderBottom: `1px solid ${V3.BORDER}`,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 500 }}>
              {t('preferences.language')}
            </div>
          </div>
          <LocaleSwitcher />
        </div>
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '14px 16px', borderBottom: `1px solid ${V3.BORDER}`,
        }}>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 500 }}>
            {t('preferences.region')}
          </div>
          <div style={{ color: V3.MUTED, fontSize: 11, lineHeight: 1.4 }}>
            {t('preferences.regionHint')}
          </div>
          <CountryPicker
            value={countryDraft}
            onChange={saveCountry}
            options={countryOptions}
            disabled={savingCountry}
          />
        </div>
        <Row
          label={t('preferences.push')}
          hint={t('preferences.pushHint')}
          control={<Toggle checked={pushEnabled} onChange={() => { void togglePush() }} />}
        />

        {/* PRIVACY & DATA */}
        <SectionHeader label={t('sections.privacy')} />
        <Link href="/privacy" style={{ textDecoration: 'none' }}>
          <Row label={t('privacy.policy')} control={<Chevron />} />
        </Link>
        <Link href="/terms" style={{ textDecoration: 'none' }}>
          <Row label={t('privacy.terms')} control={<Chevron />} />
        </Link>
        <Row
          label={t('privacy.analytics')}
          hint={t('privacy.analyticsHint')}
          control={<Toggle checked={!analyticsOptOut} onChange={toggleAnalytics} />}
        />
        <Row
          label={t('privacy.marketing')}
          hint={t('privacy.marketingHint')}
          control={<Toggle checked={profile.marketing_opt_in} onChange={toggleMarketing} />}
        />
        <Row
          label={t('privacy.exportData')}
          hint={t('privacy.exportDataHint')}
          control={<Chevron />}
          onClick={() => { void downloadExport() }}
        />
        <Row
          label={t('privacy.deleteAccount')}
          hint={t('privacy.deleteAccountHint')}
          control={<Chevron destructive />}
          onClick={() => setDeleteOpen(true)}
          destructive
        />

        {/* SUPPORT */}
        <SectionHeader label={t('sections.support')} />
        <a href="mailto:hello@padelnachos.com" style={{ textDecoration: 'none' }}>
          <Row label={t('support.contact')} control={<Chevron />} />
        </a>
        <Link href="/about" style={{ textDecoration: 'none' }}>
          <Row label={t('support.about')} control={<Chevron />} />
        </Link>

        {/* SIGN OUT */}
        <div style={{ padding: '24px 16px 14px', borderTop: `1px solid ${V3.BORDER}`, marginTop: 18 }}>
          <button
            onClick={handleSignOut}
            style={{
              width: '100%', textAlign: 'center', color: V3.LIVE_RED, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', background: 'rgba(255,70,85,0.08)', border: 'none', padding: 12,
              fontFamily: 'inherit',
              clipPath: V3.clip.button,
            }}
          >
            {t('signOut')}
          </button>
        </div>

        {/* Edit name sheet */}
        <EditNameSheet
          open={editOpen}
          initialName={profile.display_name ?? ''}
          onClose={() => setEditOpen(false)}
          onSaved={next => {
            setProfile(p => (p ? { ...p, display_name: next } : p))
            setToast(t('account.editName.savedToast'))
          }}
        />

        {/* Delete account modal */}
        <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />

        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            background: '#0A0A0A', color: '#fff', fontSize: 12,
            padding: '10px 16px', borderRadius: 10,
            border: `1px solid ${V3.BORDER}`, zIndex: 200,
          }}>
            {toast}
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 2: Build**

  ```bash
  npm run build
  ```

  Expected: build succeeds. No TS errors.

- [ ] **Step 3: Commit**

  ```bash
  git add "src/app/[locale]/(app)/profile/settings/page.tsx"
  git commit -m "feat(profile): add /profile/settings page consuming all compliance endpoints"
  ```

---

## Task 15: Localize `settings` namespace into es/pt/it/fr

**Files:**
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Insert the Spanish block into `src/messages/es.json`**

  Locate the `"profile": { … },` block in `src/messages/es.json` and insert the following immediately after the closing `,` of the profile namespace (same structural position as in en.json):

  ```json
    "settings": {
      "title": "Ajustes",
      "sections": {
        "account": "Cuenta",
        "preferences": "Preferencias",
        "privacy": "Privacidad y datos",
        "support": "Soporte"
      },
      "account": {
        "displayName": "Nombre para mostrar",
        "email": "Correo",
        "activeSessions": "Sesiones activas",
        "comingSoon": "Próximamente",
        "editName": {
          "title": "Editar nombre",
          "placeholder": "Tu nombre",
          "save": "Guardar",
          "cancel": "Cancelar",
          "savedToast": "Nombre actualizado"
        }
      },
      "preferences": {
        "language": "Idioma",
        "region": "Región",
        "regionHint": "Se usa para mostrar emisoras y contenido locales.",
        "push": "Notificaciones push",
        "pushHint": "Recibe avisos cuando empiecen tus partidos guardados"
      },
      "privacy": {
        "policy": "Política de privacidad",
        "terms": "Términos del servicio",
        "analytics": "Compartir datos de uso anónimos",
        "analyticsHint": "Ayúdanos a mejorar PadelNachos. Desactiva para no compartir.",
        "marketing": "Correos de marketing",
        "marketingHint": "Actualizaciones ocasionales sobre novedades y torneos.",
        "exportData": "Descargar mis datos",
        "exportDataHint": "Obtén un archivo JSON con todo lo que guardamos sobre ti.",
        "deleteAccount": "Eliminar mi cuenta",
        "deleteAccountHint": "Elimina permanentemente tu cuenta y tus datos."
      },
      "support": {
        "contact": "Contactar con soporte",
        "about": "Sobre PadelNachos"
      },
      "signOut": "Cerrar sesión",
      "deleteModal": {
        "title": "¿Eliminar tu cuenta?",
        "body": "Esto eliminará para siempre tu perfil, favoritos, insignias, valoraciones y métodos de inicio de sesión. No se puede deshacer.",
        "continue": "Continuar",
        "cancel": "Cancelar",
        "confirmPrompt": "Escribe ELIMINAR para confirmar",
        "confirmWord": "ELIMINAR",
        "confirmButton": "Eliminar para siempre",
        "errorGeneric": "No pudimos eliminar tu cuenta. Inténtalo de nuevo o contacta con soporte."
      }
    },
  ```

- [ ] **Step 2: Insert the Portuguese block into `src/messages/pt.json`**

  Same structural position. Content:

  ```json
    "settings": {
      "title": "Definições",
      "sections": {
        "account": "Conta",
        "preferences": "Preferências",
        "privacy": "Privacidade e dados",
        "support": "Suporte"
      },
      "account": {
        "displayName": "Nome a apresentar",
        "email": "E-mail",
        "activeSessions": "Sessões ativas",
        "comingSoon": "Em breve",
        "editName": {
          "title": "Editar nome",
          "placeholder": "O teu nome",
          "save": "Guardar",
          "cancel": "Cancelar",
          "savedToast": "Nome atualizado"
        }
      },
      "preferences": {
        "language": "Idioma",
        "region": "Região",
        "regionHint": "Usado para mostrar emissores e conteúdo locais.",
        "push": "Notificações push",
        "pushHint": "Recebe aviso quando os teus jogos guardados começarem"
      },
      "privacy": {
        "policy": "Política de privacidade",
        "terms": "Termos de serviço",
        "analytics": "Partilhar dados de utilização anónimos",
        "analyticsHint": "Ajuda a melhorar o PadelNachos. Desliga para não partilhar.",
        "marketing": "E-mails de marketing",
        "marketingHint": "Atualizações ocasionais sobre novidades e torneios.",
        "exportData": "Transferir os meus dados",
        "exportDataHint": "Obtém um ficheiro JSON com tudo o que temos sobre ti.",
        "deleteAccount": "Eliminar a minha conta",
        "deleteAccountHint": "Remove permanentemente a tua conta e os teus dados."
      },
      "support": {
        "contact": "Contactar o suporte",
        "about": "Sobre o PadelNachos"
      },
      "signOut": "Terminar sessão",
      "deleteModal": {
        "title": "Eliminar a tua conta?",
        "body": "Isto remove permanentemente o teu perfil, favoritos, emblemas, avaliações e métodos de início de sessão. Não é reversível.",
        "continue": "Continuar",
        "cancel": "Cancelar",
        "confirmPrompt": "Escreve ELIMINAR para confirmar",
        "confirmWord": "ELIMINAR",
        "confirmButton": "Eliminar para sempre",
        "errorGeneric": "Não foi possível eliminar a conta. Tenta novamente ou contacta o suporte."
      }
    },
  ```

- [ ] **Step 3: Insert the Italian block into `src/messages/it.json`**

  Same structural position. Content:

  ```json
    "settings": {
      "title": "Impostazioni",
      "sections": {
        "account": "Account",
        "preferences": "Preferenze",
        "privacy": "Privacy e dati",
        "support": "Supporto"
      },
      "account": {
        "displayName": "Nome visualizzato",
        "email": "Email",
        "activeSessions": "Sessioni attive",
        "comingSoon": "In arrivo",
        "editName": {
          "title": "Modifica nome",
          "placeholder": "Il tuo nome",
          "save": "Salva",
          "cancel": "Annulla",
          "savedToast": "Nome aggiornato"
        }
      },
      "preferences": {
        "language": "Lingua",
        "region": "Regione",
        "regionHint": "Usata per mostrare emittenti e contenuti locali.",
        "push": "Notifiche push",
        "pushHint": "Ricevi un avviso quando iniziano le partite salvate"
      },
      "privacy": {
        "policy": "Informativa sulla privacy",
        "terms": "Termini di servizio",
        "analytics": "Condividi dati di utilizzo anonimi",
        "analyticsHint": "Aiutaci a migliorare PadelNachos. Disattiva per non condividere.",
        "marketing": "Email di marketing",
        "marketingHint": "Aggiornamenti occasionali su novità e tornei.",
        "exportData": "Scarica i miei dati",
        "exportDataHint": "Ottieni un file JSON con tutto ciò che abbiamo su di te.",
        "deleteAccount": "Elimina il mio account",
        "deleteAccountHint": "Rimuove definitivamente il tuo account e i tuoi dati."
      },
      "support": {
        "contact": "Contatta il supporto",
        "about": "Informazioni su PadelNachos"
      },
      "signOut": "Esci",
      "deleteModal": {
        "title": "Eliminare il tuo account?",
        "body": "Verranno rimossi definitivamente profilo, preferiti, badge, valutazioni e metodi di accesso. L'operazione non è reversibile.",
        "continue": "Continua",
        "cancel": "Annulla",
        "confirmPrompt": "Scrivi ELIMINA per confermare",
        "confirmWord": "ELIMINA",
        "confirmButton": "Elimina per sempre",
        "errorGeneric": "Impossibile eliminare l'account. Riprova o contatta il supporto."
      }
    },
  ```

- [ ] **Step 4: Insert the French block into `src/messages/fr.json`**

  Same structural position. Content:

  ```json
    "settings": {
      "title": "Paramètres",
      "sections": {
        "account": "Compte",
        "preferences": "Préférences",
        "privacy": "Confidentialité et données",
        "support": "Assistance"
      },
      "account": {
        "displayName": "Nom affiché",
        "email": "E-mail",
        "activeSessions": "Sessions actives",
        "comingSoon": "Bientôt disponible",
        "editName": {
          "title": "Modifier le nom",
          "placeholder": "Votre nom",
          "save": "Enregistrer",
          "cancel": "Annuler",
          "savedToast": "Nom mis à jour"
        }
      },
      "preferences": {
        "language": "Langue",
        "region": "Région",
        "regionHint": "Sert à afficher les diffuseurs et contenus locaux.",
        "push": "Notifications push",
        "pushHint": "Soyez averti quand vos matchs favoris commencent"
      },
      "privacy": {
        "policy": "Politique de confidentialité",
        "terms": "Conditions d'utilisation",
        "analytics": "Partager des données d'usage anonymes",
        "analyticsHint": "Aidez à améliorer PadelNachos. Désactivez pour refuser.",
        "marketing": "E-mails marketing",
        "marketingHint": "Mises à jour occasionnelles sur les nouveautés et tournois.",
        "exportData": "Télécharger mes données",
        "exportDataHint": "Obtenez un fichier JSON de tout ce que nous avons sur vous.",
        "deleteAccount": "Supprimer mon compte",
        "deleteAccountHint": "Supprime définitivement votre compte et vos données."
      },
      "support": {
        "contact": "Contacter l'assistance",
        "about": "À propos de PadelNachos"
      },
      "signOut": "Se déconnecter",
      "deleteModal": {
        "title": "Supprimer votre compte ?",
        "body": "Cela supprime définitivement votre profil, favoris, badges, notes et méthodes de connexion. Action irréversible.",
        "continue": "Continuer",
        "cancel": "Annuler",
        "confirmPrompt": "Tapez SUPPRIMER pour confirmer",
        "confirmWord": "SUPPRIMER",
        "confirmButton": "Supprimer définitivement",
        "errorGeneric": "Impossible de supprimer le compte. Réessayez ou contactez l'assistance."
      }
    },
  ```

- [ ] **Step 5: Validate all five JSON files**

  ```bash
  for f in en es pt it fr; do \
    node -e "JSON.parse(require('fs').readFileSync('src/messages/${f}.json','utf8'))" && echo "${f} OK"; \
  done
  ```

  Expected: prints `en OK`, `es OK`, `pt OK`, `it OK`, `fr OK`.

- [ ] **Step 6: Build the app**

  ```bash
  npm run build
  ```

  Expected: build succeeds.

- [ ] **Step 7: Commit**

  ```bash
  git add src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
  git commit -m "feat(i18n): localize settings namespace into es, pt, it, fr"
  ```

---

## Post-merge QA checklist (run manually on preview)

These are not tasks but verification steps the operator performs on a Vercel preview deploy before merging to main. See spec §Testing strategy for the full list.

- [ ] Gear icon on `/profile` navigates to `/profile/settings`.
- [ ] Display-name edit sheet saves, toast appears, `/profile` header reflects the new name on navigating back.
- [ ] Language switcher in the settings page switches the app locale.
- [ ] Region picker writes `profiles.preferred_country` (verify in Supabase).
- [ ] Push notifications toggle subscribes / unsubscribes (verify via `push_subscriptions` table).
- [ ] Privacy and Terms links open `/privacy` and `/terms` in-app in all 5 locales.
- [ ] Analytics opt-out: toggle on, reload, confirm no `va.js` request in Network tab; toggle off, reload, confirm `va.js` loads again.
- [ ] Marketing toggle flips `profiles.marketing_opt_in` in DB (verify via SQL).
- [ ] `GET /api/user/export` downloads a valid JSON file; keys `p256dh`/`auth` are absent from `push_subscriptions[]`.
- [ ] `DELETE /api/user/account` on a throwaway test user wipes every row listed in spec §3.1:

  ```sql
  -- Run for the test user id $UID; all must return 0.
  SELECT count(*) FROM user_badges        WHERE user_id = '$UID';
  SELECT count(*) FROM user_bookmarks     WHERE user_id = '$UID';
  SELECT count(*) FROM push_subscriptions WHERE user_id = '$UID';
  SELECT count(*) FROM match_ratings      WHERE user_id = '$UID';
  SELECT count(*) FROM feature_interest   WHERE user_id = '$UID';
  SELECT count(*) FROM user_activity_log  WHERE user_id = '$UID';
  SELECT count(*) FROM profiles           WHERE id      = '$UID';
  SELECT count(*) FROM sessions           WHERE "userId" = '$UID';
  SELECT count(*) FROM accounts           WHERE "userId" = '$UID';
  SELECT count(*) FROM users              WHERE id      = '$UID';
  ```

- [ ] Delete modal requires typing the localized confirm word; button stays disabled until the input matches.
- [ ] Delete flow signs the user out and redirects to `/home?deleted=1`.
- [ ] `mailto:hello@padelnachos.com` opens the default mail app.
- [ ] About link routes to `/about`.
- [ ] Sign out at the bottom of settings works and redirects to `/home`.

## Security review checkpoints

- [ ] Both `/api/user/account` and `/api/user/export` call `getUserOrFail()` as their first statement. No SQL query executes before auth succeeds.
- [ ] `/api/user/account` uses a single `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`. It does NOT issue a series of `supabase.from(...).delete()` calls (those are not transactional).
- [ ] Every query in `/api/user/export` is scoped by `user_id = $userId`, `id = $userId`, or `"userId" = $userId`. The `referrals.invited` query filters by `referred_by = $userId`, not by the invited user's id.
- [ ] `GatedAnalytics` returns `null` on the initial client render (before `useEffect` reads localStorage) to avoid a tracker flash for opted-out users.
