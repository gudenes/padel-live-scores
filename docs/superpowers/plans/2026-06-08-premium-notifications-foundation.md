# Premium Notifications — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Pro entitlement + notification-tier gating model and all user-facing surfaces (settings 4-group layout with locked Pro rows, `/pro` waitlist page) so Pro notifications can be built and tested behind a manually-set `profiles.plan` flag — with **zero new senders**.

**Architecture:** A `profiles.plan` column is the single source of truth for entitlement, read through a pure `isPro()` helper. The notification catalog (`src/lib/notification-categories.ts`) gains per-category `tier` + `group` metadata and a pure `shouldDeliverToRecipient(category, plan)` gate. The existing `/api/push/notify` fan-out applies that gate per recipient (latent for now — all current categories are free). The settings page and a new `/pro` page consume `tier`/`plan` to lock and upsell.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, Supabase (Postgres), next-intl (5 locales), Vitest. Design system: chunky `clip-path` components, lime `#7ED321` on `#0A0A0A`, lucide SVG icons, `IconSlider` / `PressButton`.

**Spec:** `docs/superpowers/specs/2026-06-08-premium-notifications-design.md`

**Conventions reminder (from AGENTS.md):** This Next.js has breaking changes vs training data — when touching routing/pages, skim `node_modules/next/dist/docs/` first. Migrations are applied with the repo's pg-driver runner **`node scripts/apply-migration.mjs <sql-file> [profiles-column]`** (NOT `supabase db push`, and `psql` is not installed). That script reads `DATABASE_URL` from `.env.local` in the cwd — the worktree already has `.env.local` copied in and `node_modules` installed. The DB is the shared Supabase project; this migration is additive + idempotent (`IF NOT EXISTS`), so it is safe to apply.

**Reusable ad-hoc DB query** (for verification + manual plan flips below — psql substitute):
```bash
node -e "import('pg').then(async ({Pool})=>{const fs=await import('node:fs');for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^[\"']|[\"']$/g,'')}const u=new URL(process.env.DATABASE_URL);const p=new Pool({host:u.hostname,port:+(u.port||5432),database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:false}});console.log(JSON.stringify((await p.query(process.argv[1])).rows,null,2));await p.end()})" "SELECT 1"
```
Swap the final `"SELECT 1"` for the query you need.

---

## File Structure

**Create:**
- `supabase/migrations/20260608_premium_notifications_foundation.sql` — `profiles.plan`, `profiles.plan_expires_at`, `pro_waitlist` table.
- `src/lib/entitlements.ts` — `isPro()`, `Plan` type, `PlanRow` type. Single responsibility: entitlement decisions.
- `src/lib/__tests__/entitlements.test.ts` — unit tests for `isPro()`.
- `src/app/api/user/plan/route.ts` — `GET` current user's plan (for the settings page to know locked state).
- `src/app/api/pro/waitlist/route.ts` — `POST` join waitlist (auth required).
- `src/app/[locale]/(app)/pro/page.tsx` — the Pro upsell/waitlist page.
- `src/app/[locale]/(app)/pro/ProWaitlistButton.tsx` — client island (PressButton + POST).

**Modify:**
- `src/lib/notification-categories.ts` — add `CATEGORY_META` (tier + group), new category keys, derive `CATEGORY_DEFAULTS`, add `isProCategory()`, `categoriesForTier()`, `shouldDeliverToRecipient()`, `CATEGORY_GROUPS`.
- `src/lib/__tests__/notification-categories.test.ts` — extend with tier/gate tests.
- `src/app/api/push/notify/route.ts` — select `plan, plan_expires_at`, build `planByUser`, apply `shouldDeliverToRecipient` gate in the per-recipient loop.
- `src/app/api/user/notification-prefs/route.ts` — GET returns `plan` + per-category `tier`/`locked`; PATCH rejects enabling a Pro category for a non-Pro user.
- `src/app/[locale]/(app)/profile/settings/notifications/page.tsx` — 4 groups, render new categories, locked Pro rows (gold badge + lock → route to `/pro`), fetch plan.
- `src/messages/{en,es,pt,it,fr}.json` — new `notifications.settings.*` group/category keys + `pro.*` namespace.

---

## Task 1: DB migration — entitlement column + waitlist table

**Files:**
- Create: `supabase/migrations/20260608_premium_notifications_foundation.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260608_premium_notifications_foundation.sql
-- Premium Notifications foundation: Pro entitlement + waitlist.
-- Apply via:  psql "$DATABASE_URL" -f supabase/migrations/20260608_premium_notifications_foundation.sql
-- (NOT `supabase db push` — repo has migration drift.)

-- 1. Entitlement on profiles. Default 'free'; billing (later spec) flips to 'pro'.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro')),
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.plan IS
  'Entitlement tier. free|pro. Flipped manually until billing ships (see premium-notifications spec).';
COMMENT ON COLUMN public.profiles.plan_expires_at IS
  'Optional expiry for time-boxed Pro. NULL = no expiry. isPro() treats past expiry as free.';

-- 2. Pro waitlist (billing deferred — /pro CTA captures interest).
CREATE TABLE IF NOT EXISTS public.pro_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NULL,
  locale text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.pro_waitlist ENABLE ROW LEVEL SECURITY;
-- No anon/auth policies → only the service-role key (server routes) can read/write.
```

- [ ] **Step 2: Apply the migration**

Run: `node scripts/apply-migration.mjs supabase/migrations/20260608_premium_notifications_foundation.sql plan`
Expected: prints `Applied. Verification:` with the `plan` column row (data_type `text`, default `'free'::text`, nullable `NO`). Re-running is safe (`IF NOT EXISTS`).

- [ ] **Step 3: Verify columns + table exist**

Run (using the reusable ad-hoc query snippet from the plan header — replace the SELECT):
```bash
# columns
node -e "...snippet..." "SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name IN ('plan','plan_expires_at')"
# waitlist table
node -e "...snippet..." "SELECT column_name FROM information_schema.columns WHERE table_name='pro_waitlist' ORDER BY ordinal_position"
```
Expected: both `plan` and `plan_expires_at` listed; `pro_waitlist` shows `id,user_id,email,locale,created_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608_premium_notifications_foundation.sql
git commit -m "feat(db): profiles.plan entitlement + pro_waitlist table"
```

---

## Task 2: Entitlement helper (`isPro`)

**Files:**
- Create: `src/lib/entitlements.ts`
- Test: `src/lib/__tests__/entitlements.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/entitlements.test.ts
import { describe, it, expect } from 'vitest'
import { isPro, type PlanRow } from '@/lib/entitlements'

const FAR_FUTURE = '2999-01-01T00:00:00Z'
const PAST = '2000-01-01T00:00:00Z'

describe('isPro', () => {
  it('returns false for free plan', () => {
    expect(isPro({ plan: 'free', plan_expires_at: null })).toBe(false)
  })
  it('returns true for pro plan with no expiry', () => {
    expect(isPro({ plan: 'pro', plan_expires_at: null })).toBe(true)
  })
  it('returns true for pro plan not yet expired', () => {
    expect(isPro({ plan: 'pro', plan_expires_at: FAR_FUTURE })).toBe(true)
  })
  it('returns false for pro plan past expiry', () => {
    expect(isPro({ plan: 'pro', plan_expires_at: PAST })).toBe(false)
  })
  it('returns false for null/undefined row (anon or missing profile)', () => {
    expect(isPro(null)).toBe(false)
    expect(isPro(undefined)).toBe(false)
  })
  it('treats unknown plan string as not pro', () => {
    expect(isPro({ plan: 'enterprise' as PlanRow['plan'], plan_expires_at: null })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: FAIL — `Cannot find module '@/lib/entitlements'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/entitlements.ts
// Single source of truth for Pro entitlement decisions.
// `profiles.plan` is flipped manually until billing ships (premium-notifications spec).

export type Plan = 'free' | 'pro'

export type PlanRow = {
  plan: Plan
  plan_expires_at: string | null
}

/**
 * True iff the row is on the Pro plan and not past its (optional) expiry.
 * Null/undefined (anon users, missing profile) → false.
 */
export function isPro(row: Pick<PlanRow, 'plan' | 'plan_expires_at'> | null | undefined): boolean {
  if (!row || row.plan !== 'pro') return false
  if (row.plan_expires_at == null) return true
  const expiry = Date.parse(row.plan_expires_at)
  if (Number.isNaN(expiry)) return true // unparseable expiry → don't punish a paying user
  return expiry > Date.now()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/entitlements.ts src/lib/__tests__/entitlements.test.ts
git commit -m "feat(lib): isPro entitlement helper"
```

---

## Task 3: Notification catalog — tier, groups, and the delivery gate

**Files:**
- Modify: `src/lib/notification-categories.ts`
- Test: `src/lib/__tests__/notification-categories.test.ts`

This adds every new category (so settings can render the full catalog now) plus the tier/group metadata and the pure gate. Senders for the new categories come in Plans 2–4.

- [ ] **Step 1: Write the failing tests (append to existing test file)**

```ts
// Append to src/lib/__tests__/notification-categories.test.ts
import {
  CATEGORY_META,
  KNOWN_CATEGORIES,
  isProCategory,
  categoriesForTier,
  shouldDeliverToRecipient,
  CATEGORY_GROUPS,
} from '@/lib/notification-categories'

describe('category tiers', () => {
  it('every known category has tier + group metadata', () => {
    for (const cat of KNOWN_CATEGORIES) {
      expect(CATEGORY_META[cat]).toBeDefined()
      expect(['free', 'pro']).toContain(CATEGORY_META[cat].tier)
      expect(CATEGORY_GROUPS).toContain(CATEGORY_META[cat].group)
    }
  })
  it('existing categories stay free', () => {
    expect(isProCategory('match_live_follow')).toBe(false)
    expect(isProCategory('match_finished')).toBe(false)
    expect(isProCategory('marketing')).toBe(false)
  })
  it('new pro categories are pro', () => {
    expect(isProCategory('match_deciding_set')).toBe(true)
    expect(isProCategory('prematch_prediction')).toBe(true)
    expect(isProCategory('daily_oop')).toBe(true)
    expect(isProCategory('projection_outperform')).toBe(true)
  })
  it('new free categories are free', () => {
    expect(isProCategory('match_scheduled')).toBe(false)
    expect(isProCategory('draw_released')).toBe(false)
    expect(isProCategory('weekly_digest')).toBe(false)
  })
  it('categoriesForTier(free) excludes pro categories', () => {
    const free = categoriesForTier('free')
    expect(free).toContain('match_finished')
    expect(free).not.toContain('match_deciding_set')
  })
  it('categoriesForTier(pro) includes everything', () => {
    expect(categoriesForTier('pro')).toEqual(KNOWN_CATEGORIES)
  })
})

describe('shouldDeliverToRecipient', () => {
  it('free category always delivers', () => {
    expect(shouldDeliverToRecipient('match_finished', false)).toBe(true)
    expect(shouldDeliverToRecipient('match_finished', true)).toBe(true)
  })
  it('pro category delivers only to pro recipients', () => {
    expect(shouldDeliverToRecipient('match_deciding_set', false)).toBe(false)
    expect(shouldDeliverToRecipient('match_deciding_set', true)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/notification-categories.test.ts`
Expected: FAIL — `CATEGORY_META`/`isProCategory`/etc. not exported.

- [ ] **Step 3: Rewrite `notification-categories.ts`**

Replace the category type, defaults block, and add metadata + helpers. Full file:

```ts
// src/lib/notification-categories.ts
//
// Single source of truth for notification categories. Used by:
//   - /api/push/notify  (writer — resolves per-user prefs + tier gate before fanout)
//   - /api/notifications  (read/filter)
//   - /api/user/notification-prefs  (validation + GET resolver, tier annotation)
//   - /profile/settings/notifications  (UI render — grouped, locked Pro rows)
//
// 2026-06-08: added per-category `tier` (free|pro) + `group`, the full premium
// notification catalog (senders land in later plans), and the delivery gate
// shouldDeliverToRecipient(). Pro categories are withheld entirely (push AND
// in-app inbox) from non-Pro recipients — see premium-notifications spec.

import { type Plan } from '@/lib/entitlements'

export type ChannelPrefs = { push: boolean }

export type NotificationCategory =
  // existing
  | 'match_live_follow'
  | 'match_live_bookmark'
  | 'match_finished'
  | 'ranking_updated'
  | 'marketing'
  // new — free
  | 'match_scheduled'
  | 'player_title_won'
  | 'player_eliminated'
  | 'tournament_starting'
  | 'draw_released'
  | 'player_entered'
  | 'weekly_digest'
  // new — pro
  | 'match_deciding_set'
  | 'match_upset_live'
  | 'next_match_drawn'
  | 'ranking_threshold'
  | 'projection_outperform'
  | 'player_path'
  | 'prematch_prediction'
  | 'daily_oop'
  | 'tournament_wrapup'

export type CategoryGroup = 'matches' | 'results' | 'tournaments' | 'predictions'
export const CATEGORY_GROUPS: CategoryGroup[] = ['matches', 'results', 'tournaments', 'predictions']

export type Tier = 'free' | 'pro'

export type CategoryMeta = {
  defaults: ChannelPrefs
  tier: Tier
  group: CategoryGroup
}

// Order within this record = render order within each group.
export const CATEGORY_META: Record<NotificationCategory, CategoryMeta> = {
  // ── Matches ──
  match_live_follow:    { defaults: { push: true }, tier: 'free', group: 'matches' },
  match_live_bookmark:  { defaults: { push: true }, tier: 'free', group: 'matches' },
  match_finished:       { defaults: { push: true }, tier: 'free', group: 'matches' },
  match_scheduled:      { defaults: { push: true }, tier: 'free', group: 'matches' },
  match_deciding_set:   { defaults: { push: true }, tier: 'pro',  group: 'matches' },
  match_upset_live:     { defaults: { push: true }, tier: 'pro',  group: 'matches' },
  next_match_drawn:     { defaults: { push: true }, tier: 'pro',  group: 'matches' },
  // ── Results & milestones ──
  player_title_won:     { defaults: { push: true }, tier: 'free', group: 'results' },
  player_eliminated:    { defaults: { push: true }, tier: 'free', group: 'results' },
  ranking_updated:      { defaults: { push: true }, tier: 'free', group: 'results' },
  ranking_threshold:    { defaults: { push: true }, tier: 'pro',  group: 'results' },
  projection_outperform:{ defaults: { push: true }, tier: 'pro',  group: 'results' },
  // ── Tournaments & draws ──
  tournament_starting:  { defaults: { push: true }, tier: 'free', group: 'tournaments' },
  draw_released:        { defaults: { push: true }, tier: 'free', group: 'tournaments' },
  player_entered:       { defaults: { push: true }, tier: 'free', group: 'tournaments' },
  player_path:          { defaults: { push: true }, tier: 'pro',  group: 'tournaments' },
  // ── Predictions & digests ──
  prematch_prediction:  { defaults: { push: true }, tier: 'pro',  group: 'predictions' },
  daily_oop:            { defaults: { push: true }, tier: 'pro',  group: 'predictions' },
  weekly_digest:        { defaults: { push: true }, tier: 'free', group: 'predictions' },
  tournament_wrapup:    { defaults: { push: true }, tier: 'pro',  group: 'predictions' },
  marketing:            { defaults: { push: true }, tier: 'free', group: 'predictions' },
}

// Derived for backward compat — resolvePrefs() reads this.
export const CATEGORY_DEFAULTS: Record<NotificationCategory, ChannelPrefs> = Object.fromEntries(
  (Object.keys(CATEGORY_META) as NotificationCategory[]).map((k) => [k, CATEGORY_META[k].defaults]),
) as Record<NotificationCategory, ChannelPrefs>

export const KNOWN_CATEGORIES = Object.keys(CATEGORY_META) as NotificationCategory[]

export function isKnownCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (KNOWN_CATEGORIES as string[]).includes(value)
}

export function isProCategory(category: NotificationCategory): boolean {
  return CATEGORY_META[category].tier === 'pro'
}

/** Categories a plan is allowed to receive. Free excludes pro categories. */
export function categoriesForTier(plan: Plan): NotificationCategory[] {
  if (plan === 'pro') return KNOWN_CATEGORIES
  return KNOWN_CATEGORIES.filter((c) => !isProCategory(c))
}

/**
 * The single delivery gate. Pro categories are withheld entirely (push AND
 * in-app inbox) from non-Pro recipients. Free categories always pass.
 */
export function shouldDeliverToRecipient(category: NotificationCategory, recipientIsPro: boolean): boolean {
  if (!isProCategory(category)) return true
  return recipientIsPro
}

/**
 * Merge a stored JSONB prefs object with code defaults for a given category.
 * Missing `push` or missing category entry falls back to defaults. Stored
 * orphan keys (e.g. `inApp` from before 2026-05-27) are silently dropped.
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
  filter: 'all' | 'matches' | 'updates' | string,
): NotificationCategory[] | null {
  switch (filter) {
    case 'all':
      return null
    case 'matches':
      return KNOWN_CATEGORIES.filter((c) => CATEGORY_META[c].group === 'matches')
    case 'updates':
      return KNOWN_CATEGORIES.filter((c) => CATEGORY_META[c].group !== 'matches')
    default:
      return []
  }
}
```

> NOTE: `categoryFilter` previously hardcoded `['ranking_updated','marketing']` for `'updates'`. It now derives from groups so the inbox filter pills keep working as categories grow. If the inbox filter UI references specific category lists elsewhere, leave those untouched — this function is the only behavioral change.

- [ ] **Step 4: Run to verify the new + existing tests pass**

Run: `npx vitest run src/lib/__tests__/notification-categories.test.ts`
Expected: PASS (existing tests + new tier/gate tests). If an existing test asserted the exact `'updates'` array, update it to the new group-derived expectation.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notification-categories.ts src/lib/__tests__/notification-categories.test.ts
git commit -m "feat(lib): notification catalog tiers, groups + delivery gate"
```

---

## Task 4: Wire the tier gate into `/api/push/notify`

**Files:**
- Modify: `src/app/api/push/notify/route.ts` (line ~38 import; line ~356 profiles select; per-recipient loop ~400-410)

The gate is latent today (all match-path categories are free) but must be in place so Plans 3+ get correct withholding for free.

- [ ] **Step 1: Add imports**

At the existing import (line ~38):
```ts
import { resolvePrefs, shouldDeliverToRecipient, type ChannelPrefs, type NotificationCategory } from '@/lib/notification-categories'
import { isPro } from '@/lib/entitlements'
```

- [ ] **Step 2: Select plan columns + build a planByUser map**

Find the profiles select (line ~356):
```ts
supabase.from('profiles').select('id, notification_prefs, notification_mute_until').in('id', filteredUserIds),
```
Change to:
```ts
supabase.from('profiles').select('id, notification_prefs, notification_mute_until, plan, plan_expires_at').in('id', filteredUserIds),
```

Where `prefsByUser` / `muteUntilByUser` are populated (the loop around line ~363-367), add a `planByUser` map alongside:
```ts
const planByUser = new Map<string, boolean>() // userId → isPro
// inside the same for-loop over profile rows:
planByUser.set(
  row.id as string,
  isPro({
    plan: (row as { plan?: 'free' | 'pro' }).plan ?? 'free',
    plan_expires_at: (row as { plan_expires_at?: string | null }).plan_expires_at ?? null,
  }),
)
```

- [ ] **Step 3: Apply the gate in the per-recipient loop**

In the loop `for (const [userId, reason] of recipientReason)` (line ~400), right after `category` is computed (line ~404-406) and BEFORE `resolvePrefs`/job building:
```ts
// Tier gate: Pro categories are withheld entirely (push + in-app) from non-Pro users.
if (!shouldDeliverToRecipient(category as NotificationCategory, planByUser.get(userId) ?? false)) {
  continue
}
```

> If the in-app `user_notifications` insert for authed recipients happens in a SEPARATE loop later in this file, add the identical `continue` guard there too, keyed on the same `category` + `planByUser.get(userId)`. Grep the file for `user_notifications` to confirm; the gate must cover BOTH push and inbox.

- [ ] **Step 4: Verify the build + existing notify behavior is unchanged**

Run: `npm run build`
Expected: compiles. Because every category on the match-notify path is free (`match_live_*`, `match_finished`), the gate is a no-op today — existing live/finished pushes still fan out to all recipients.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/push/notify/route.ts
git commit -m "feat(notify): apply Pro tier gate per recipient (latent until Pro senders land)"
```

---

## Task 5: Prefs API — expose plan + tier, reject Pro enable for free users

**Files:**
- Modify: `src/app/api/user/notification-prefs/route.ts`
- Create: `src/app/api/user/plan/route.ts`

- [ ] **Step 1: Add a plan GET endpoint**

```ts
// src/app/api/user/plan/route.ts
// GET → { plan: 'free' | 'pro', isPro: boolean }
import { getUserOrFail } from '../_auth'
import { isPro, type Plan } from '@/lib/entitlements'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data, error: dbErr } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .maybeSingle()
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  const plan = ((data?.plan as Plan | undefined) ?? 'free')
  const pro = isPro({ plan, plan_expires_at: (data?.plan_expires_at as string | null) ?? null })
  return Response.json({ plan: pro ? 'pro' : 'free', isPro: pro })
}
```

- [ ] **Step 2: Annotate prefs GET with tier + locked, and guard PATCH**

In `src/app/api/user/notification-prefs/route.ts`:

Update imports:
```ts
import {
  isKnownCategory,
  isProCategory,
  CATEGORY_META,
  resolveAllPrefs,
  KNOWN_CATEGORIES,
  type ChannelPrefs,
  type NotificationCategory,
} from '@/lib/notification-categories'
import { isPro, type Plan } from '@/lib/entitlements'
```

In `GET`, also select plan and return `plan` + a `meta` map:
```ts
const { data, error: dbErr } = await supabase
  .from('profiles')
  .select('notification_prefs, notification_mute_until, plan, plan_expires_at')
  .eq('id', user.id)
  .maybeSingle()
if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

const stored = (data?.notification_prefs ?? null) as Record<string, Partial<ChannelPrefs>> | null
const plan = ((data?.plan as Plan | undefined) ?? 'free')
const userIsPro = isPro({ plan, plan_expires_at: (data?.plan_expires_at as string | null) ?? null })

const meta = Object.fromEntries(
  KNOWN_CATEGORIES.map((c) => [c, {
    tier: CATEGORY_META[c].tier,
    group: CATEGORY_META[c].group,
    locked: CATEGORY_META[c].tier === 'pro' && !userIsPro,
  }]),
)

return Response.json({
  prefs: resolveAllPrefs(stored),
  mute_until: (data as { notification_mute_until?: string | null } | null)?.notification_mute_until ?? null,
  plan: userIsPro ? 'pro' : 'free',
  meta,
})
```

In `PATCH`, after `const category = body.category as NotificationCategory` and after the `hasPush` check, reject enabling a Pro category for a non-Pro user:
```ts
if (isProCategory(category) && body.push === true) {
  const { data: planRow } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .maybeSingle()
  const userIsPro = isPro({
    plan: ((planRow?.plan as Plan | undefined) ?? 'free'),
    plan_expires_at: (planRow?.plan_expires_at as string | null) ?? null,
  })
  if (!userIsPro) {
    return Response.json({ error: 'pro_required' }, { status: 403 })
  }
}
```

- [ ] **Step 3: Verify build + manual check**

Run: `npm run build`
Then with the dev server (`npm run dev`) and a signed-in session cookie, verify:
```bash
curl -s http://localhost:3002/api/user/plan          # → {"plan":"free","isPro":false}
curl -s http://localhost:3002/api/user/notification-prefs | head -c 400   # includes "plan" and "meta" with locked:true on pro categories
```
Expected: `meta.match_deciding_set.locked === true` for a free user.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/user/plan/route.ts src/app/api/user/notification-prefs/route.ts
git commit -m "feat(api): expose plan + per-category tier/locked; reject Pro-enable for free users"
```

---

## Task 6: Settings page — 4 groups, locked Pro rows

**Files:**
- Modify: `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`

- [ ] **Step 1: Replace the GROUPS definition with the 4-group catalog (driven by CATEGORY_META)**

Replace lines 30-34:
```ts
import { CATEGORY_META, type NotificationCategory, type ChannelPrefs, type CategoryGroup } from '@/lib/notification-categories'

const GROUP_ORDER: CategoryGroup[] = ['matches', 'results', 'tournaments', 'predictions']
const GROUPS: { key: CategoryGroup; categories: NotificationCategory[] }[] = GROUP_ORDER.map((g) => ({
  key: g,
  categories: (Object.keys(CATEGORY_META) as NotificationCategory[]).filter((c) => CATEGORY_META[c].group === g),
}))
```
(Remove the old `Group` type + `import { type NotificationCategory ... }` duplication — keep a single import line.)

- [ ] **Step 2: Add plan state + fetch**

After the `prefs` state (line ~40), add:
```ts
const [userIsPro, setUserIsPro] = useState(false)
```
In the prefs-load effect (line ~54), the response already can carry `plan` (Task 5). Parse it:
```ts
const body = await res.json() as {
  prefs: Record<NotificationCategory, ChannelPrefs>
  mute_until?: string | null
  plan?: 'free' | 'pro'
}
if (!cancelled) {
  setPrefs(body.prefs)
  setMuteUntil(body.mute_until ?? null)
  setUserIsPro(body.plan === 'pro')
}
```

- [ ] **Step 3: Render locked Pro rows**

Replace the group-render block (lines 323-369) so each row branches on locked state. A row is locked when `CATEGORY_META[cat].tier === 'pro' && !userIsPro`:

```tsx
{prefs && GROUPS.map(group => (
  <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, padding: '10px 4px 2px' }}>
      {t(`group.${group.key}`)}
    </div>
    {group.categories.map(cat => {
      const pref = prefs[cat]
      const state = saveStates[cat] ?? 'idle'
      const isProCat = CATEGORY_META[cat].tier === 'pro'
      const locked = isProCat && !userIsPro
      const disabledByMaster = !pushEnabled || permissionDenied
      return (
        <div
          key={cat}
          onClick={locked ? () => router.push('/pro') : undefined}
          style={{
            padding: '14px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12,
            opacity: !locked && disabledByMaster ? 0.45 : 1,
            cursor: locked ? 'pointer' : 'default',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0, opacity: locked ? 0.6 : 1 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              {t(`category.${cat}.label`)}
              {isProCat && (
                <span style={{
                  fontSize: 9, fontWeight: 900, letterSpacing: 0.4, textTransform: 'uppercase',
                  color: '#0a0a0a', background: '#EAB308', padding: '2px 6px',
                  clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
                }}>{t('proBadge')}</span>
              )}
            </span>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>
              {t(`category.${cat}.sub`)}
            </span>
          </div>
          {locked ? (
            <span style={{ color: '#EAB308', flexShrink: 0, display: 'flex' }} aria-label={t('proBadge')}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <IconSlider
                checked={pref.push}
                onChange={(next) => void patchCategory(cat, { push: next })}
                disabled={disabledByMaster}
                ariaLabel={t(`category.${cat}.label`)}
              />
              <SaveStateSlot
                state={state}
                onSavedFlashEnd={() => setSaveStates(s => ({ ...s, [cat]: 'idle' }))}
              />
            </div>
          )}
        </div>
      )
    })}
  </section>
))}
```

> The group header key changed from `t(group.key)` (old `groupMatches`/`groupUpdates`) to `t('group.<key>')`. Add those i18n keys in Task 8. Remove the now-unused old group keys if nothing else references them.

- [ ] **Step 4: Verify in the running app**

Run: `npm run dev` (localhost:3002), sign in, open `/profile/settings/notifications`.
Expected: 4 group headers; free rows toggle and save; Pro rows show the gold PRO badge + lock; tapping a Pro row navigates to `/pro`. (Flip your own profile to Pro to confirm toggles appear: run the ad-hoc query snippet with `"UPDATE profiles SET plan='pro' WHERE id='<your-uuid>'"` then reload — badges remain, toggles return. Set back to `'free'` after.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/profile/settings/notifications/page.tsx"
git commit -m "feat(settings): 4-group notification layout with locked Pro rows"
```

---

## Task 7: `/pro` page + waitlist endpoint

**Files:**
- Create: `src/app/api/pro/waitlist/route.ts`
- Create: `src/app/[locale]/(app)/pro/page.tsx`
- Create: `src/app/[locale]/(app)/pro/ProWaitlistButton.tsx`

- [ ] **Step 1: Waitlist POST endpoint**

```ts
// src/app/api/pro/waitlist/route.ts
// POST → joins the Pro waitlist for the signed-in user. Idempotent (UNIQUE user_id).
import { getUserOrFail } from '../../user/_auth'

export async function POST(request: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await request.json().catch(() => ({})) as { locale?: unknown }
  const locale = typeof body.locale === 'string' ? body.locale : null

  const { error: dbErr } = await supabase
    .from('pro_waitlist')
    .upsert(
      { user_id: user.id, email: user.email ?? null, locale },
      { onConflict: 'user_id' },
    )
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Waitlist client button (PressButton + POST + joined state)**

```tsx
// src/app/[locale]/(app)/pro/ProWaitlistButton.tsx
'use client'
import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

export default function ProWaitlistButton() {
  const t = useTranslations('pro')
  const locale = useLocale()
  const [state, setState] = useState<'idle' | 'saving' | 'joined' | 'error'>('idle')

  const join = async () => {
    if (state === 'saving' || state === 'joined') return
    setState('saving')
    try {
      const res = await fetch('/api/pro/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      setState(res.ok ? 'joined' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div style={{ marginTop: 18 }}>
      <PressButton
        {...PRESS_PRESETS.chunkyTilted}
        onClick={join}
        disabled={state === 'saving' || state === 'joined'}
        style={{ width: '100%', padding: '15px', fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5 }}
      >
        {state === 'joined' ? t('cta.joined') : state === 'saving' ? t('cta.saving') : t('cta.join')}
      </PressButton>
      <div style={{ textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 12 }}>
        {state === 'error' ? t('cta.error') : t('cta.sub')}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `/pro` page (server component, chunky style, no emoji)**

```tsx
// src/app/[locale]/(app)/pro/page.tsx
import { getTranslations } from 'next-intl/server'
import ProWaitlistButton from './ProWaitlistButton'

const FEATURES = [
  { key: 'drama' },
  { key: 'road' },
  { key: 'predictions' },
  { key: 'briefing' },
] as const

export default async function ProPage() {
  const t = await getTranslations('pro')
  return (
    <main style={{ background: '#0A0A0A', minHeight: '100vh', paddingBottom: 80 }}>
      <div style={{ padding: '24px 16px 8px', textAlign: 'center' }}>
        <span style={{ color: '#EAB308', display: 'inline-flex' }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" />
          </svg>
        </span>
        <h1 style={{ fontSize: 23, fontWeight: 800, color: '#fff', margin: '10px 0 6px' }}>{t('hero.title')}</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, margin: 0, padding: '0 6px' }}>{t('hero.sub')}</p>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FEATURES.map(f => (
          <div key={f.key} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 14px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
          }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{t(`features.${f.key}.title`)}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 3, lineHeight: 1.4 }}>{t(`features.${f.key}.body`)}</div>
            </div>
          </div>
        ))}
        <ProWaitlistButton />
      </div>
    </main>
  )
}
```

> AGENTS.md: confirm the `[locale]/(app)` route + `getTranslations` usage against `node_modules/next/dist/docs/` and an existing `(app)` page before finalizing (params/async conventions differ from older Next).

- [ ] **Step 4: Verify**

Run: `npm run dev`, visit `/pro` (and `/es/pro`). Click the CTA → button shows "joined"; confirm a row:
```bash
psql "$DATABASE_URL" -c "SELECT user_id, locale FROM pro_waitlist ORDER BY created_at DESC LIMIT 3;"
```
Expected: page renders in chunky style; one waitlist row inserted; re-clicking does not duplicate (UNIQUE user_id upsert).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/pro/waitlist/route.ts" "src/app/[locale]/(app)/pro/page.tsx" "src/app/[locale]/(app)/pro/ProWaitlistButton.tsx"
git commit -m "feat(pro): /pro upsell page + waitlist endpoint"
```

---

## Task 8: i18n keys (5 locales)

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

next-intl needs every referenced key present in each locale or rendering throws. Add real English copy to `en.json`; for `es/pt/it/fr` add the SAME keys (English text is an acceptable first pass — flag for translation later).

- [ ] **Step 1: Add the `notifications.settings` group + category keys**

Under `notifications.settings` in `en.json`, add:
```json
"proBadge": "Pro",
"group": {
  "matches": "Matches",
  "results": "Results & milestones",
  "tournaments": "Tournaments & draws",
  "predictions": "Predictions & digests"
},
"category": {
  "match_live_follow":   { "label": "Match is live", "sub": "A followed match starts" },
  "match_live_bookmark": { "label": "Bookmarked match is live", "sub": "A match you saved starts" },
  "match_finished":      { "label": "Match finished", "sub": "Final result is in" },
  "match_scheduled":     { "label": "Match scheduled", "sub": "Time & court announced" },
  "match_deciding_set":  { "label": "Going the distance", "sub": "Match heads to a deciding 3rd set" },
  "match_upset_live":    { "label": "Upset in progress", "sub": "An underdog is leading live" },
  "next_match_drawn":    { "label": "Next match drawn", "sub": "Their next opponent is set" },
  "player_title_won":    { "label": "Title won", "sub": "Your player wins the event" },
  "player_eliminated":   { "label": "Eliminated", "sub": "Your player is knocked out" },
  "ranking_updated":     { "label": "Rankings updated", "sub": "Your players moved this week" },
  "ranking_threshold":   { "label": "Ranking milestone", "sub": "Crosses #1 / top 10 / top 20" },
  "projection_outperform": { "label": "Beating the bracket", "sub": "Going further than projected" },
  "tournament_starting": { "label": "Tournament starting", "sub": "A followed event begins" },
  "draw_released":       { "label": "Draw released", "sub": "Bracket is published" },
  "player_entered":      { "label": "Player entered", "sub": "Your player signs up for an event" },
  "player_path":         { "label": "Player's path", "sub": "Draw position + next opponent" },
  "prematch_prediction": { "label": "Pre-match prediction", "sub": "Model odds before they play" },
  "daily_oop":           { "label": "Daily order of play", "sub": "Your players' matches today" },
  "weekly_digest":       { "label": "Weekly digest", "sub": "Your week + weekend champions" },
  "tournament_wrapup":   { "label": "Tournament wrap-up", "sub": "Recap when an event ends" },
  "marketing":           { "label": "News & announcements", "sub": "Product updates from PadelNachos" }
}
```

> If `notifications.settings` already has a `category` object (old 5 categories), MERGE — keep existing keys, add the new ones. Remove the obsolete `groupMatches`/`groupUpdates` keys only after confirming nothing else references them (grep).

- [ ] **Step 2: Add the `pro` namespace (top level of each messages file)**

```json
"pro": {
  "hero": {
    "title": "Never miss a moment",
    "sub": "Live drama, draw intel, model predictions and your personal padel briefing — for the players you follow."
  },
  "features": {
    "drama":       { "title": "Be there for the drama", "body": "Deciding sets and live upsets, the instant they happen." },
    "road":        { "title": "Know the road ahead", "body": "Draw paths, next opponents and \"beating the bracket\" alerts." },
    "predictions": { "title": "Predictions & milestones", "body": "Pre-match model odds and ranking milestones for your players." },
    "briefing":    { "title": "Your personal briefing", "body": "Daily order of play and tournament wrap-ups." }
  },
  "cta": {
    "join": "Notify me when Pro launches",
    "saving": "Joining…",
    "joined": "You're on the list",
    "error": "Something went wrong — try again",
    "sub": "Join the waitlist · billing coming soon"
  }
}
```

- [ ] **Step 3: Mirror keys into es/pt/it/fr**

Add the identical `notifications.settings.group`, `notifications.settings.proBadge`, the new `notifications.settings.category.*` entries, and the `pro` namespace to `es.json`, `pt.json`, `it.json`, `fr.json`. English copy is acceptable as a placeholder; mark a follow-up for real translation.

- [ ] **Step 4: Verify all locales build**

Run: `npm run build`
Expected: no next-intl "missing message" errors for any locale. Spot-check `/es/pro` and `/fr/profile/settings/notifications` in `npm run dev`.

- [ ] **Step 5: Commit**

```bash
git add src/messages/*.json
git commit -m "i18n: notification group/category labels + pro namespace (en + locale stubs)"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full test suite (touched files)**

Run:
```bash
npx vitest run src/lib/__tests__/entitlements.test.ts src/lib/__tests__/notification-categories.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: success, no type errors, no missing-i18n errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean (or only pre-existing warnings).

- [ ] **Step 4: End-to-end manual smoke (the acceptance criteria)**

With `npm run dev` + a signed-in user:
1. `/profile/settings/notifications` shows 4 groups; free toggles save; Pro rows locked with gold badge + lock.
2. Tapping a Pro row → `/pro`; CTA joins waitlist (row in `pro_waitlist`).
3. Flip to Pro via the ad-hoc query snippet (`UPDATE profiles SET plan='pro' WHERE id='<uuid>'`) → reload settings → Pro rows now have working toggles; `/api/user/plan` returns `pro`.
4. Trigger a normal live/finished match push (`/api/admin/test-push`) → still delivers (free categories unaffected by the gate).
5. Revert via the snippet: `UPDATE profiles SET plan='free' WHERE id='<uuid>'`.

- [ ] **Step 5: Commit any fixes, then push the branch**

```bash
git push -u origin feat/premium-notifications
```

---

## Self-Review notes (coverage check against the spec)

- **Entitlement (`profiles.plan` + `isPro`)** → Tasks 1, 2. ✓
- **Category `tier` + gate at single chokepoint** → Tasks 3, 4 (`shouldDeliverToRecipient`, withholds push AND inbox via the `continue` guard — Task 4 Step 3 note covers a separate inbox loop if present). ✓
- **Prefs API tier annotation + PATCH guard** → Task 5. ✓
- **Settings 4-group + locked rows + gold PRO badge + no emoji (SVG lock)** → Task 6. ✓
- **`/pro` waitlist page (billing deferred), chunky style** → Task 7. ✓
- **i18n 5 locales** → Task 8. ✓
- **Manual `plan` flag as test path** → Task 6 Step 4, Task 9 Step 4. ✓
- **No "Premier" label in UI** → no category copy uses "Premier"; ⚡ is internal-only. ✓
- **Out of scope (correctly deferred to later plans):** all new senders (Plans 2–4), the generic notify contract for non-match events (Plan 2), Stripe/billing (separate spec).
```
