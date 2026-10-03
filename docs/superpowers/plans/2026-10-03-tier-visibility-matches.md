# Tier Visibility on /matches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator hide whole tournament tiers (e.g. FIP Promises, FIP Beyond) from the public /matches page via a toggle in the admin, without a deploy.

**Architecture:** A new `tier_visibility` table holds one row per tournament `level` with a `show_on_matches` switch. A tiny cached resolver (`src/lib/tier-visibility.ts`) returns the hidden levels; the two /matches-only data helpers (`fetch-matches-day.ts`, `fetch-matches-calendar.ts`) push the exclusion into the PostgREST query. The admin (`apps/ops`) gets a `/system/tier-visibility` page backed by two internal API routes and a stats SQL function.

**Tech Stack:** Next.js 16 (root app + `apps/ops`), Supabase/PostgREST via `@supabase/supabase-js` 2.99, Postgres migration applied with `pg` + `DATABASE_URL`, vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-27-tier-visibility-design.md` (re-scoped 2026-10-03).

---

## Ground rules for the executor

- Work ONLY in `/Volumes/Crucial/dev/padel-tier-visibility` (branch `feat/tier-visibility`). The main checkout's branch is switched by other sessions.
- Every Bash call: prefix with `cd /Volumes/Crucial/dev/padel-tier-visibility &&` — the shell cwd resets between calls.
- Don't pipe test output through `tail`/`head` when you need the exit code; read vitest's own `Tests  N passed` line.
- **Do NOT apply the migration to prod, and do NOT deploy.** Gustavo approves those separately (CLAUDE.md "Talk before any fix"). Task 7 stops at local verification.

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20261003120000_tier_visibility.sql` | create | Table, RLS, trigger, seed, `tier_visibility_stats()` |
| `src/lib/tier-visibility.ts` | create | `fetchMatchesHiddenTiers()` (60s TTL, fail-open) + `tierExclusionFilter()` pure helper |
| `src/lib/__tests__/tier-visibility.test.ts` | create | Unit tests for the above |
| `src/lib/fetch-matches-day.ts` | modify | Apply exclusion to the day query |
| `src/lib/__tests__/fetch-matches-day-tiers.test.ts` | create | Query-shape tests (hidden / none hidden) |
| `src/lib/fetch-matches-calendar.ts` | modify | Apply exclusion to window query + live count |
| `src/lib/__tests__/fetch-matches-calendar.test.ts` | modify | Fake builder gains `or`/`in`/options; new tier tests |
| `apps/ops/src/app/api/internal/tier-visibility/route.ts` | create | GET: tiers + stats + config |
| `apps/ops/src/app/api/internal/tier-visibility/[level]/route.ts` | create | PATCH: upsert `show_on_matches` |
| `apps/ops/src/app/api/internal/tier-visibility/__tests__/route.test.ts` | create | Auth + validation + merge tests |
| `apps/ops/src/app/(app)/system/tier-visibility/page.tsx` | create | Server page shell |
| `apps/ops/src/app/(app)/system/tier-visibility/_components/TierVisibilityTab.tsx` | create | Client table with toggles |
| `apps/ops/src/components/shell/Rail.tsx` | modify | Rail entry |
| `apps/ops/src/lib/command-palette.ts` | modify | ⌘K entry |

---

### Task 0: Worktree setup

- [ ] **Step 1: Symlink node_modules (worktrees don't have them)**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && ln -s /Volumes/Crucial/dev/padel-live-scores/node_modules node_modules && ln -s /Volumes/Crucial/dev/padel-live-scores/apps/ops/node_modules apps/ops/node_modules && git status --short
```

Then exclude the ops symlink locally (root `node_modules` is gitignored, `apps/ops/node_modules` as a symlink is not):

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && echo "apps/ops/node_modules" >> "$(git rev-parse --git-path info/exclude)" && git status --short
```

Expected: no `node_modules` entries. Never `git add -A` in this plan.

- [ ] **Step 2: Baseline test run**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && npx vitest run src/lib/__tests__/fetch-matches-calendar.test.ts
```

Expected: **`6 failed | 5 passed`** — a PRE-EXISTING failure on main: the fake builder in `makeFakeSupabase` has no `.in()` method, but the LIVE-pill count added later calls `.in('status', …)`. Task 4 Step 1 adds `in`/`or`/`then` to the fake, which repairs these 6 as a side effect.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261003120000_tier_visibility.sql`

- [ ] **Step 1: Write the migration**

```sql
-- tier_visibility — operator-controlled visibility of tournament tiers.
-- One row per tournaments.level. v1 has a single switch,
-- show_on_matches, which governs ONLY the public /matches day page
-- (list, day-pill dots, LIVE-pill gate). Every other surface ignores it.
-- A level with no row is shown. Public-read RLS, service-role writes —
-- same shape as feature_flags (20260520_feature_flags.sql).
-- Spec: docs/superpowers/specs/2026-09-27-tier-visibility-design.md

BEGIN;

CREATE TABLE IF NOT EXISTS tier_visibility (
  level            TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  show_on_matches  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       TEXT
);

COMMENT ON TABLE tier_visibility IS 'Ops-controlled per-tier visibility. Public-read RLS, service-role writes.';
COMMENT ON COLUMN tier_visibility.show_on_matches IS 'When false, matches of this tier are excluded from the public /matches page only.';

CREATE OR REPLACE FUNCTION tier_visibility_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tier_visibility_updated_at_trigger ON tier_visibility;
CREATE TRIGGER tier_visibility_updated_at_trigger
  BEFORE UPDATE ON tier_visibility
  FOR EACH ROW EXECUTE FUNCTION tier_visibility_set_updated_at();

ALTER TABLE tier_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tier_visibility_public_read ON tier_visibility;
CREATE POLICY tier_visibility_public_read ON tier_visibility
  FOR SELECT
  USING (true);

-- Seed: every level present in tournaments on 2026-10-03. Labels mirror
-- levelLabel(), sort_order mirrors levelTierWeight() (50 = unmapped).
-- Promises + Beyond start hidden, matching HIDDEN_TOURNAMENT_LEVELS.
INSERT INTO tier_visibility (level, label, show_on_matches, sort_order) VALUES
  ('finals',           'Finals',           TRUE,  0),
  ('major',            'Major',            TRUE,  1),
  ('p1',               'P1',               TRUE,  2),
  ('p2',               'P2',               TRUE,  3),
  ('fip_platinum',     'FIP Platinum',     TRUE,  4),
  ('fip_gold',         'FIP Gold',         TRUE,  5),
  ('fip_championship', 'FIP Championship', TRUE,  7),
  ('fip_finals',       'FIP Finals',       TRUE,  8),
  ('fip_silver',       'FIP Silver',       TRUE,  10),
  ('fip_bronze',       'FIP Bronze',       TRUE,  12),
  ('fip_promises',     'FIP Promises',     FALSE, 20),
  ('fip_beyond',       'FIP Beyond',       FALSE, 22),
  ('fip_other',        'FIP Tour',         TRUE,  25),
  ('ppl',              'PPL',              TRUE,  50),
  ('ppl_ii',           'PPL II',           TRUE,  50),
  ('wpt_final',        'WPT Final',        TRUE,  50),
  ('wpt_master',       'WPT Master',       TRUE,  50),
  ('wpt_1000',         'WPT 1000',         TRUE,  50),
  ('wpt_500',          'WPT 500',          TRUE,  50)
ON CONFLICT (level) DO NOTHING;

-- Per-level counts for the admin page. Service role only.
CREATE OR REPLACE FUNCTION tier_visibility_stats()
RETURNS TABLE (level TEXT, tournaments BIGINT, matches_90d BIGINT, live_now BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT
    t.level,
    COUNT(DISTINCT t.id)                                                        AS tournaments,
    COUNT(m.id) FILTER (WHERE m.scheduled_at > now() - interval '90 days')      AS matches_90d,
    COUNT(m.id) FILTER (WHERE m.status IN ('live', 'on_court'))                 AS live_now
  FROM tournaments t
  LEFT JOIN matches m ON m.tournament_id = t.id
  WHERE t.level IS NOT NULL
  GROUP BY t.level
$$;

REVOKE ALL ON FUNCTION tier_visibility_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tier_visibility_stats() TO service_role;

COMMIT;
```

- [ ] **Step 2: Syntax-check it in a rolled-back transaction against the real DB**

This executes the migration inside an outer transaction and rolls it back, so nothing persists. The file's own `BEGIN;`/`COMMIT;` are stripped first.

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && set -a && source /Volumes/Crucial/dev/padel-live-scores/.env.local && set +a && node -e "
const fs=require('fs');const {Client}=require('pg');
const sql=fs.readFileSync('supabase/migrations/20261003120000_tier_visibility.sql','utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
const c=new Client({connectionString:process.env.DATABASE_URL});
(async()=>{await c.connect();await c.query('BEGIN');try{await c.query(sql);
const r=await c.query('select * from tier_visibility_stats() order by matches_90d desc limit 5');console.table(r.rows);
const h=await c.query('select level from tier_visibility where not show_on_matches');console.log('hidden:',h.rows.map(x=>x.level));
}finally{await c.query('ROLLBACK');await c.end();console.log('rolled back')}})().catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: a stats table (fip_bronze/fip_silver near the top), `hidden: [ 'fip_promises', 'fip_beyond' ]`, `rolled back`.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && git add supabase/migrations/20261003120000_tier_visibility.sql && git commit -m "feat(tiers): tier_visibility table + stats function

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Resolver module

**Files:**
- Create: `src/lib/tier-visibility.ts`
- Test: `src/lib/__tests__/tier-visibility.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchMatchesHiddenTiers,
  tierExclusionFilter,
  __resetTierVisibilityCache,
} from '../tier-visibility'

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = []
  const builder: any = {
    select: (cols: string) => { calls.push(['select', cols]); return builder },
    eq: (col: string, val: unknown) => {
      calls.push(['eq', col, val])
      return Promise.resolve(result)
    },
  }
  const client: any = {
    from: (table: string) => { calls.push(['from', table]); return builder },
  }
  return { client, calls }
}

describe('tierExclusionFilter', () => {
  it('returns null when nothing is hidden', () => {
    expect(tierExclusionFilter([])).toBeNull()
  })

  it('keeps null levels and excludes the hidden ones', () => {
    expect(tierExclusionFilter(['fip_promises', 'fip_beyond'])).toBe(
      'level.is.null,level.not.in.(fip_promises,fip_beyond)',
    )
  })
})

describe('fetchMatchesHiddenTiers', () => {
  beforeEach(() => __resetTierVisibilityCache())

  it('returns levels with show_on_matches = false', async () => {
    const { client, calls } = fakeClient({
      data: [{ level: 'fip_promises' }, { level: 'fip_beyond' }],
      error: null,
    })
    expect(await fetchMatchesHiddenTiers(client)).toEqual(['fip_promises', 'fip_beyond'])
    expect(calls).toContainEqual(['from', 'tier_visibility'])
    expect(calls).toContainEqual(['eq', 'show_on_matches', false])
  })

  it('serves from cache within the TTL', async () => {
    const { client, calls } = fakeClient({ data: [{ level: 'fip_beyond' }], error: null })
    await fetchMatchesHiddenTiers(client, 1_000)
    await fetchMatchesHiddenTiers(client, 30_000)
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(1)
  })

  it('refetches after the TTL', async () => {
    const { client, calls } = fakeClient({ data: [], error: null })
    await fetchMatchesHiddenTiers(client, 1_000)
    await fetchMatchesHiddenTiers(client, 62_000)
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(2)
  })

  it('fails open on query error and does not cache the failure', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, calls } = fakeClient({ data: null, error: { message: 'relation does not exist' } })
    expect(await fetchMatchesHiddenTiers(client, 1_000)).toEqual([])
    await fetchMatchesHiddenTiers(client, 2_000)
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(2)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && npx vitest run src/lib/__tests__/tier-visibility.test.ts
```

Expected: FAIL — `Failed to resolve import "../tier-visibility"`.

- [ ] **Step 3: Implement**

```ts
// src/lib/tier-visibility.ts
//
// Operator-controlled tier visibility. Reads the `tier_visibility`
// table (one row per tournaments.level). v1 has a single switch,
// `show_on_matches`, consumed only by the /matches data helpers
// (fetch-matches-day, fetch-matches-calendar).
//
// Fail-open: any read error → hide nothing, so /matches never goes
// blank because of this table (including before the migration lands).
// A level with no row is shown; a null tournaments.level is never hidden.
//
// Spec: docs/superpowers/specs/2026-09-27-tier-visibility-design.md

import type { SupabaseClient } from '@supabase/supabase-js'

const TTL_MS = 60_000

let cache: { value: string[]; expiresAt: number } | null = null

/** Test hook — clears the module-level cache. */
export function __resetTierVisibilityCache(): void {
  cache = null
}

/**
 * Levels hidden from the /matches page. Cached for 60s per server
 * instance — the matches page is force-dynamic, so this keeps it to
 * one tiny query per minute rather than one per request.
 */
export async function fetchMatchesHiddenTiers(
  supabase: SupabaseClient,
  now: number = Date.now(),
): Promise<string[]> {
  if (cache && cache.expiresAt > now) return cache.value

  const { data, error } = await supabase
    .from('tier_visibility')
    .select('level')
    .eq('show_on_matches', false)

  if (error) {
    console.warn('[tier-visibility] read failed, hiding nothing:', error.message)
    return []
  }

  const value = ((data ?? []) as Array<{ level: string }>).map((r) => r.level)
  cache = { value, expiresAt: now + TTL_MS }
  return value
}

/**
 * PostgREST `or` filter for the embedded tournaments resource that
 * drops hidden levels but keeps NULL levels (`level not in (...)` alone
 * is NULL for a NULL level and would hide unclassified tournaments).
 *
 * Returns null when nothing is hidden — callers must then skip the
 * filter AND the `!inner` join entirely (`not.in.()` is a 400).
 */
export function tierExclusionFilter(hiddenLevels: readonly string[]): string | null {
  if (hiddenLevels.length === 0) return null
  return `level.is.null,level.not.in.(${hiddenLevels.join(',')})`
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && npx vitest run src/lib/__tests__/tier-visibility.test.ts
```

Expected: `Tests  6 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && git add src/lib/tier-visibility.ts src/lib/__tests__/tier-visibility.test.ts && git commit -m "feat(tiers): cached fail-open hidden-tier resolver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Filter the day list (`fetch-matches-day.ts`)

**Files:**
- Modify: `src/lib/fetch-matches-day.ts` (imports at top; `MATCH_SELECT` constant ~line 118; query in `fetchMatchesDay` ~lines 180–192)
- Test: `src/lib/__tests__/fetch-matches-day-tiers.test.ts`

Approach: the select string's tournament embed becomes `tournaments!inner(...)` **only** when something is hidden, and the `or` filter targets the embed by its alias `tournament`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hidden = vi.hoisted(() => ({ value: [] as string[] }))
vi.mock('../tier-visibility', async (orig) => {
  const actual = await orig<typeof import('../tier-visibility')>()
  return { ...actual, fetchMatchesHiddenTiers: async () => hidden.value }
})

import { fetchMatchesDay } from '../fetch-matches-day'

function fakeClient() {
  const calls: Array<[string, ...unknown[]]> = []
  const builder: any = {
    select: (cols: string) => { calls.push(['select', cols]); return builder },
    or: (f: string, opts?: unknown) => { calls.push(['or', f, opts]); return builder },
    order: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
  }
  return { client: { from: () => builder } as any, calls }
}

describe('fetchMatchesDay tier visibility', () => {
  beforeEach(() => { hidden.value = [] })

  it('inner-joins tournaments and excludes hidden levels', async () => {
    hidden.value = ['fip_promises', 'fip_beyond']
    const { client, calls } = fakeClient()
    await fetchMatchesDay(client, '2026-10-03', 'UTC')

    const select = calls.find((c) => c[0] === 'select')![1] as string
    expect(select).toContain('tournament:tournaments!inner(')
    expect(calls).toContainEqual([
      'or',
      'level.is.null,level.not.in.(fip_promises,fip_beyond)',
      { referencedTable: 'tournament' },
    ])
  })

  it('leaves the query untouched when nothing is hidden', async () => {
    const { client, calls } = fakeClient()
    await fetchMatchesDay(client, '2026-10-03', 'UTC')

    const select = calls.find((c) => c[0] === 'select')![1] as string
    expect(select).toContain('tournament:tournaments(')
    expect(select).not.toContain('!inner')
    expect(calls.filter((c) => c[0] === 'or')).toHaveLength(1) // only the date-window or
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && npx vitest run src/lib/__tests__/fetch-matches-day-tiers.test.ts
```

Expected: first test FAILS (select has no `!inner`); second passes.

- [ ] **Step 3: Implement**

Add to the imports at the top of `src/lib/fetch-matches-day.ts`:

```ts
import { fetchMatchesHiddenTiers, tierExclusionFilter } from './tier-visibility'
```

Change the tournament line inside `MATCH_SELECT` from

```ts
  tournament:tournaments(id, name, level, country, timezone, starts_at, ends_at, status),
```

to

```ts
  tournament:tournaments__JOIN__(id, name, level, country, timezone, starts_at, ends_at, status),
```

Then replace the query block (from `const { data: rawMatches, error } = await supabase` through `.limit(400)`) with:

```ts
  // Operator-hidden tiers (tier_visibility.show_on_matches = false) are
  // excluded DB-side so they don't eat the 400-row budget on busy days.
  // With nothing hidden the embed stays a plain left join.
  const tierFilter = tierExclusionFilter(await fetchMatchesHiddenTiers(supabase))
  const select = MATCH_SELECT.replace('__JOIN__', tierFilter ? '!inner' : '')

  let query = supabase
    .from('matches')
    .select(select)
    .or(
      `and(scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
        `and(finished_at.gte.${startIso},finished_at.lt.${new Date(
          endUtc.getTime() + 7 * ONE_DAY_MS,
        ).toISOString()})` +
        (isToday ? `,status.in.(live,on_court)` : ''),
    )
  if (tierFilter) query = query.or(tierFilter, { referencedTable: 'tournament' })

  const { data: rawMatches, error } = await query
    .order('scheduled_at', { ascending: true })
    .limit(400)
```

Also update the header comment's "Used by" list — append one line after the existing bullets:

```ts
// Hidden tiers: see ./tier-visibility (admin /system/tier-visibility).
```

- [ ] **Step 4: Run tests + typecheck**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && npx vitest run src/lib/__tests__/fetch-matches-day-tiers.test.ts && npx tsc --noEmit -p tsconfig.json
```

Expected: `Tests  2 passed`, tsc exits 0. If tsc complains that `select` loses the typed-row inference: the result is already cast via `as unknown as MatchesDayMatch[]`, so annotate `const select: string = ...`.

- [ ] **Step 5: Verify the PostgREST shape against the real DB (read-only)**

The table doesn't exist in prod yet, so exercise the query directly with a hardcoded hidden list:

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && set -a && source /Volumes/Crucial/dev/padel-live-scores/.env.local && set +a && npx tsx -e "
import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
const base = () => s.from('matches').select('id, tournament:tournaments!inner(level)').gte('scheduled_at','2026-01-01').lt('scheduled_at','2026-03-01').limit(5000)
const all = await s.from('matches').select('id, tournament:tournaments(level)').gte('scheduled_at','2026-01-01').lt('scheduled_at','2026-03-01').limit(5000)
const filt = await base().or('level.is.null,level.not.in.(fip_promises,fip_beyond)', { referencedTable: 'tournament' })
if (filt.error) throw new Error(filt.error.message)
const lv = (r: any) => r.tournament?.level
console.log('all', all.data!.length, 'promises', all.data!.filter(r => lv(r)==='fip_promises').length)
console.log('filtered', filt.data!.length, 'promises left', filt.data!.filter(r => ['fip_promises','fip_beyond'].includes(lv(r))).length)
"
```

Expected: `filtered` = `all` − promises/beyond count, `promises left 0`, no error. If PostgREST rejects the alias, switch `referencedTable` to `'tournaments'` in both this check and Task 3/4 code + tests, and re-run.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && git add src/lib/fetch-matches-day.ts src/lib/__tests__/fetch-matches-day-tiers.test.ts && git commit -m "feat(tiers): exclude hidden tiers from the /matches day list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Filter day pills + LIVE pill (`fetch-matches-calendar.ts`)

**Files:**
- Modify: `src/lib/fetch-matches-calendar.ts` (imports; `Promise.all` block ~lines 88–100)
- Modify: `src/lib/__tests__/fetch-matches-calendar.test.ts`

- [ ] **Step 1: Extend the fake builder and add failing tests**

In `src/lib/__tests__/fetch-matches-calendar.test.ts`:

(a) At the top, after the vitest import, add the mock:

```ts
const hidden = vi.hoisted(() => ({ value: [] as string[] }))
vi.mock('../tier-visibility', async (orig) => {
  const actual = await orig<typeof import('../tier-visibility')>()
  return { ...actual, fetchMatchesHiddenTiers: async () => hidden.value }
})
```

(b) In `makeFakeSupabase`, replace the `select` method with one that records options, and add `or` and `in` (the live-count query ends on `.in` / `.or`, so both must be awaitable):

```ts
    select: (cols: string, opts?: unknown) => {
      captured.filters.push(['select', cols, opts])
      return builder
    },
    or: (f: string, opts?: unknown) => {
      captured.filters.push(['or', f, opts])
      return builder
    },
    in: (col: string, vals: unknown) => {
      captured.filters.push(['in', col, vals])
      return builder
    },
    then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
```

(c) Add `beforeEach(() => { hidden.value = [] })` inside `describe('fetchMatchesCalendar', ...)` (import `beforeEach` from vitest), and append these tests to that describe:

```ts
  it('applies the tier exclusion to the window query and the live count', async () => {
    hidden.value = ['fip_promises']
    const { client, capturedQuery } = makeFakeSupabase([])
    await fetchMatchesCalendar(client, 'en', 'UTC', NOW)

    const selects = capturedQuery.filters.filter((f) => f[0] === 'select')
    expect(selects).toHaveLength(2)
    for (const s of selects) expect(s[1]).toContain('tournament:tournaments!inner(level)')

    const ors = capturedQuery.filters.filter((f) => f[0] === 'or')
    expect(ors).toHaveLength(2)
    for (const o of ors) {
      expect(o[1]).toBe('level.is.null,level.not.in.(fip_promises)')
      expect(o[2]).toEqual({ referencedTable: 'tournament' })
    }
  })

  it('leaves both queries unjoined when nothing is hidden', async () => {
    const { client, capturedQuery } = makeFakeSupabase([])
    await fetchMatchesCalendar(client, 'en', 'UTC', NOW)
    const selects = capturedQuery.filters.filter((f) => f[0] === 'select')
    for (const s of selects) expect(s[1]).not.toContain('!inner')
    expect(capturedQuery.filters.filter((f) => f[0] === 'or')).toHaveLength(0)
  })
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && npx vitest run src/lib/__tests__/fetch-matches-calendar.test.ts
```

Expected: the 6 previously-broken tests now PASS (fake has `.in` + thenable); `applies the tier exclusion…` FAILS; `leaves both queries unjoined…` passes.

- [ ] **Step 3: Implement**

Add the import in `src/lib/fetch-matches-calendar.ts`:

```ts
import { fetchMatchesHiddenTiers, tierExclusionFilter } from './tier-visibility'
```

Replace the `const [windowRes, liveRes] = await Promise.all([...])` block with:

```ts
  // Operator-hidden tiers (tier_visibility.show_on_matches = false) must
  // not light up a day pill or the LIVE pill over a list that won't show
  // them. The inner join is only added when something is hidden.
  const tierFilter = tierExclusionFilter(await fetchMatchesHiddenTiers(supabase))
  const tierJoin = tierFilter ? ', tournament:tournaments!inner(level)' : ''

  let windowQuery = supabase
    .from('matches')
    .select(`scheduled_at${tierJoin}`)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', todayStartUtc.toISOString())
    .lt('scheduled_at', horizonStartUtc.toISOString())
  let liveQuery = supabase
    .from('matches')
    .select(`id${tierJoin}`, { count: 'exact', head: true })
    .in('status', ['live', 'on_court'])
  if (tierFilter) {
    windowQuery = windowQuery.or(tierFilter, { referencedTable: 'tournament' })
    liveQuery = liveQuery.or(tierFilter, { referencedTable: 'tournament' })
  }

  const [windowRes, liveRes] = await Promise.all([
    windowQuery.limit(SELECT_LIMIT),
    liveQuery,
  ])
```

(The `count`/`head` comment above the old block still applies — keep it.)

- [ ] **Step 4: Run tests + typecheck**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && npx vitest run src/lib/__tests__/fetch-matches-calendar.test.ts src/lib/__tests__/tier-visibility.test.ts src/lib/__tests__/fetch-matches-day-tiers.test.ts && npx tsc --noEmit -p tsconfig.json
```

Expected: all pass (calendar 13 + resolver 6 + day 2 = 21), tsc exits 0. Mention in the commit message that it repairs the 6 pre-existing calendar test failures.

- [ ] **Step 5: Verify the head-count shape against the real DB (read-only)**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && set -a && source /Volumes/Crucial/dev/padel-live-scores/.env.local && set +a && npx tsx -e "
import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
const plain = await s.from('matches').select('id', { count: 'exact', head: true }).gte('scheduled_at','2026-01-01').lt('scheduled_at','2026-03-01')
const filt = await s.from('matches').select('id, tournament:tournaments!inner(level)', { count: 'exact', head: true }).gte('scheduled_at','2026-01-01').lt('scheduled_at','2026-03-01').or('level.is.null,level.not.in.(fip_promises,fip_beyond)', { referencedTable: 'tournament' })
if (filt.error) throw new Error(filt.error.message)
console.log('plain', plain.count, 'filtered', filt.count)
"
```

Expected: `filtered` < `plain` (Jan–Feb 2026 had Promises matches), no error.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && git add src/lib/fetch-matches-calendar.ts src/lib/__tests__/fetch-matches-calendar.test.ts && git commit -m "feat(tiers): exclude hidden tiers from day pills and LIVE pill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Admin API routes

**Files:**
- Create: `apps/ops/src/app/api/internal/tier-visibility/route.ts`
- Create: `apps/ops/src/app/api/internal/tier-visibility/[level]/route.ts`
- Test: `apps/ops/src/app/api/internal/tier-visibility/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  stats: { data: [] as unknown[], error: null as { message: string } | null },
  config: { data: [] as unknown[], error: null as { message: string } | null },
  upserts: [] as unknown[],
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/supabase', () => ({
  serviceClient: () => ({
    rpc: async () => mocks.stats,
    from: () => ({
      select: () => Promise.resolve(mocks.config),
      upsert: (row: unknown) => {
        mocks.upserts.push(row)
        return {
          select: () => ({ single: async () => ({ data: { ...(row as object), updated_at: 'now' }, error: null }) }),
        }
      },
    }),
  }),
}))

import { GET } from '../route'
import { PATCH } from '../[level]/route'

const patch = (level: string, body: unknown) =>
  PATCH(
    new Request(`http://x/api/internal/tier-visibility/${level}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ level }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { isOperator: true } })
  mocks.stats = { data: [], error: null }
  mocks.config = { data: [], error: null }
  mocks.upserts = []
})

describe('GET /api/internal/tier-visibility', () => {
  it('401s without an operator session', async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await GET()).status).toBe(401)
  })

  it('unions stats with config, defaults unconfigured tiers to shown, sorts by sort_order', async () => {
    mocks.stats.data = [
      { level: 'fip_bronze', tournaments: 277, matches_90d: 1796, live_now: 2 },
      { level: 'fip_new_thing', tournaments: 1, matches_90d: 3, live_now: 0 },
    ]
    mocks.config.data = [
      { level: 'fip_bronze', label: 'FIP Bronze', show_on_matches: true, sort_order: 12, updated_at: 't', updated_by: null },
      { level: 'fip_promises', label: 'FIP Promises', show_on_matches: false, sort_order: 20, updated_at: 't', updated_by: 'ops' },
    ]
    const json = await (await GET()).json()
    expect(json.tiers.map((t: any) => t.level)).toEqual(['fip_bronze', 'fip_promises', 'fip_new_thing'])
    const fresh = json.tiers.find((t: any) => t.level === 'fip_new_thing')
    expect(fresh).toMatchObject({ configured: false, show_on_matches: true, label: 'fip_new_thing', matches_90d: 3 })
    const promises = json.tiers.find((t: any) => t.level === 'fip_promises')
    expect(promises).toMatchObject({ configured: true, show_on_matches: false, tournaments: 0 })
  })

  it('500s when the stats query fails', async () => {
    mocks.stats = { data: [], error: { message: 'boom' } }
    expect((await GET()).status).toBe(500)
  })
})

describe('PATCH /api/internal/tier-visibility/[level]', () => {
  it('401s without an operator session', async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await patch('fip_promises', { show_on_matches: true })).status).toBe(401)
  })

  it('rejects a non-boolean', async () => {
    expect((await patch('fip_promises', { show_on_matches: 'yes' })).status).toBe(400)
  })

  it('upserts, keeping label from the body or falling back to the level code', async () => {
    const res = await patch('fip_new_thing', { show_on_matches: false })
    expect(res.status).toBe(200)
    expect(mocks.upserts[0]).toEqual({
      level: 'fip_new_thing',
      label: 'fip_new_thing',
      show_on_matches: false,
      updated_by: 'ops',
    })
    await patch('fip_beyond', { show_on_matches: true, label: 'FIP Beyond' })
    expect(mocks.upserts[1]).toMatchObject({ label: 'FIP Beyond', show_on_matches: true })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility/apps/ops && npx vitest run src/app/api/internal/tier-visibility
```

Expected: FAIL — cannot resolve `../route`.

- [ ] **Step 3: Implement GET**

`apps/ops/src/app/api/internal/tier-visibility/route.ts`:

```ts
// apps/ops/src/app/api/internal/tier-visibility/route.ts
// List every tournament tier with its /matches visibility + counts.
// Tier list = distinct tournaments.level (via tier_visibility_stats())
// unioned with tier_visibility rows, so a newly-invented level shows up
// without a migration. Unconfigured levels are shown by default.
// Auth: Auth.js session with isOperator flag.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

interface StatsRow { level: string; tournaments: number; matches_90d: number; live_now: number }
interface ConfigRow {
  level: string
  label: string
  show_on_matches: boolean
  sort_order: number | null
  updated_at: string
  updated_by: string | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const [statsRes, configRes] = await Promise.all([
    supabase.rpc('tier_visibility_stats'),
    supabase
      .from('tier_visibility')
      .select('level, label, show_on_matches, sort_order, updated_at, updated_by'),
  ])
  if (statsRes.error) return Response.json({ error: statsRes.error.message }, { status: 500 })
  if (configRes.error) return Response.json({ error: configRes.error.message }, { status: 500 })

  const stats = new Map(((statsRes.data ?? []) as StatsRow[]).map((s) => [s.level, s]))
  const config = new Map(((configRes.data ?? []) as ConfigRow[]).map((c) => [c.level, c]))
  const levels = new Set([...stats.keys(), ...config.keys()])

  const tiers = [...levels].map((level) => {
    const s = stats.get(level)
    const c = config.get(level)
    return {
      level,
      label: c?.label ?? level,
      configured: !!c,
      show_on_matches: c?.show_on_matches ?? true,
      sort_order: c?.sort_order ?? 999,
      updated_at: c?.updated_at ?? null,
      updated_by: c?.updated_by ?? null,
      tournaments: Number(s?.tournaments ?? 0),
      matches_90d: Number(s?.matches_90d ?? 0),
      live_now: Number(s?.live_now ?? 0),
    }
  })
  tiers.sort((a, b) => a.sort_order - b.sort_order || a.level.localeCompare(b.level))

  return Response.json({ tiers })
}
```

- [ ] **Step 4: Implement PATCH**

`apps/ops/src/app/api/internal/tier-visibility/[level]/route.ts`:

```ts
// apps/ops/src/app/api/internal/tier-visibility/[level]/route.ts
// Set a tier's show_on_matches switch. Upserts, so an unconfigured
// (newly-invented) level can be toggled straight from the admin.
// Auth: Auth.js session with isOperator flag. Service-key write bypasses RLS.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

type RouteContext = { params: Promise<{ level: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { level } = await ctx.params
  if (!level) return Response.json({ error: 'missing_level' }, { status: 400 })

  let body: { show_on_matches?: unknown; label?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body.show_on_matches !== 'boolean') {
    return Response.json({ error: 'show_on_matches_must_be_boolean' }, { status: 400 })
  }

  const row = {
    level,
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : level,
    show_on_matches: body.show_on_matches,
    updated_by: 'ops',
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('tier_visibility')
    .upsert(row, { onConflict: 'level' })
    .select('level, label, show_on_matches, sort_order, updated_at, updated_by')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ tier: data })
}
```

Note: the client (Task 6) always sends the current `label`, so toggling a seeded row never overwrites its label with the raw level code.

- [ ] **Step 5: Run to verify pass**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility/apps/ops && npx vitest run src/app/api/internal/tier-visibility
```

Expected: `Tests  6 passed`.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && git add apps/ops/src/app/api/internal/tier-visibility && git commit -m "feat(ops): tier visibility list + toggle API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin page + navigation

**Files:**
- Create: `apps/ops/src/app/(app)/system/tier-visibility/page.tsx`
- Create: `apps/ops/src/app/(app)/system/tier-visibility/_components/TierVisibilityTab.tsx`
- Modify: `apps/ops/src/components/shell/Rail.tsx:59` (after the Feature Flags entry)
- Modify: `apps/ops/src/lib/command-palette.ts:35` (after the Feature Flags entry)

- [ ] **Step 1: Page shell**

`apps/ops/src/app/(app)/system/tier-visibility/page.tsx`:

```tsx
import TierVisibilityTab from './_components/TierVisibilityTab'

export const metadata = { title: 'Tier Visibility · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function TierVisibilityPage() {
  return <TierVisibilityTab />
}
```

- [ ] **Step 2: Client component**

`apps/ops/src/app/(app)/system/tier-visibility/_components/TierVisibilityTab.tsx`:

```tsx
'use client'
// apps/ops/src/app/(app)/system/tier-visibility/_components/TierVisibilityTab.tsx
//
// One row per tournament tier with a "Show on /matches" switch backed by
// tier_visibility.show_on_matches. Only the public /matches page reads it
// (day list, day-pill dots, LIVE pill) — every other page is unaffected.
// Spec: docs/superpowers/specs/2026-09-27-tier-visibility-design.md

import { useEffect, useState } from 'react'
import { PageHeader, Panel, Button, EmptyState } from '@/components/ui'

interface Tier {
  level: string
  label: string
  configured: boolean
  show_on_matches: boolean
  updated_at: string | null
  updated_by: string | null
  tournaments: number
  matches_90d: number
  live_now: number
}

export default function TierVisibilityTab() {
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const res = await fetch('/api/internal/tier-visibility', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setTiers(json.tiers ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const toggle = async (tier: Tier, next: boolean) => {
    setPending(tier.level)
    setTiers(prev => prev.map(t => (t.level === tier.level ? { ...t, show_on_matches: next } : t)))
    try {
      const res = await fetch(`/api/internal/tier-visibility/${encodeURIComponent(tier.level)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ show_on_matches: next, label: tier.label }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${detail}`)
      }
      const { tier: saved } = await res.json()
      setTiers(prev => prev.map(t => (t.level === tier.level
        ? { ...t, configured: true, show_on_matches: saved.show_on_matches, updated_at: saved.updated_at, updated_by: saved.updated_by }
        : t)))
    } catch (e) {
      setTiers(prev => prev.map(t => (t.level === tier.level ? { ...t, show_on_matches: !next } : t)))
      alert(`Failed to toggle ${tier.level}: ${e instanceof Error ? e.message : e}`)
    } finally {
      setPending(null)
    }
  }

  const header = (
    <PageHeader
      title="Tier Visibility"
      subtitle={
        <>
          Hide whole tournament tiers from the public <code>/matches</code> page (match list, day
          pills, LIVE pill). Tournament, player, match and home pages are not affected. Changes
          take effect within ~2 minutes.
        </>
      }
    />
  )

  if (loading) {
    return (
      <div className="ui-page">
        {header}
        <div style={{ color: 'var(--text-2)' }}>Loading tiers...</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="ui-page">
        {header}
        <EmptyState title={`Failed to load: ${error}`} hint={<Button size="sm" onClick={refresh}>Retry</Button>} />
      </div>
    )
  }

  return (
    <div className="ui-page" style={{ maxWidth: 880 }}>
      {header}
      {tiers.length === 0 ? (
        <EmptyState title="No tiers found." hint={<>No <code>tournaments.level</code> values yet.</>} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tiers.map(tier => (
            <Panel key={tier.level}>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>
                    {tier.label}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                    {tier.tournaments} tournaments · {tier.matches_90d} matches last 90d · {tier.live_now} live now
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'ui-monospace, monospace' }}>
                    {tier.level}
                    {tier.configured
                      ? tier.updated_at && ` · updated ${new Date(tier.updated_at).toLocaleString()}${tier.updated_by ? ` by ${tier.updated_by}` : ''}`
                      : ' · not configured — shown by default'}
                  </div>
                </div>
                <Switch
                  label="Show on /matches"
                  value={tier.show_on_matches}
                  busy={pending === tier.level}
                  onToggle={next => toggle(tier, next)}
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}

function Switch({
  label,
  value,
  busy,
  onToggle,
}: {
  label: string
  value: boolean
  busy: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <button
        onClick={() => onToggle(!value)}
        disabled={busy}
        style={{
          position: 'relative',
          width: 44,
          height: 24,
          borderRadius: 'var(--r-lg)',
          border: 'none',
          cursor: busy ? 'wait' : 'pointer',
          background: value ? 'var(--lime)' : 'var(--border-strong)',
          transition: 'background 120ms',
          opacity: busy ? 0.6 : 1,
        }}
        aria-label={`${label}: ${value ? 'shown' : 'hidden'}`}
        aria-pressed={value}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: value ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'var(--bg-card)',
            transition: 'left 140ms',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </button>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: 3,
          background: value ? 'var(--lime-bg)' : 'var(--live-bg)',
          color: value ? 'var(--lime-text)' : 'var(--live-text)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {value ? 'Shown' : 'Hidden'}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Navigation entries**

In `apps/ops/src/components/shell/Rail.tsx`, directly after
`{ href: '/system/feature-flags', label: 'Feature Flags', icon: 'toggle' },` add:

```ts
    { href: '/system/tier-visibility', label: 'Tier Visibility', icon: 'eye' },
```

In `apps/ops/src/lib/command-palette.ts`, directly after
`{ href: '/system/feature-flags', label: 'Feature Flags', group: 'System' },` add:

```ts
  { href: '/system/tier-visibility', label: 'Tier Visibility', group: 'System' },
```

- [ ] **Step 4: Typecheck + ops tests**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility/apps/ops && npx tsc --noEmit -p tsconfig.json && npx vitest run src/app/api/internal/tier-visibility src/lib
```

Expected: tsc exits 0; tests pass (if a command-palette test asserts the page count, update its expected number by +1 and say so in the commit).

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && git add "apps/ops/src/app/(app)/system/tier-visibility" apps/ops/src/components/shell/Rail.tsx apps/ops/src/lib/command-palette.ts && git commit -m "feat(ops): Tier Visibility admin page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Local verification (no prod writes)

The table doesn't exist in prod and must not be created without Gustavo's go-ahead. So verification is in two halves.

- [ ] **Step 1: Fail-open check — the real app with the table missing**

Start the root app dev server from the worktree (port 3002) and load `/matches/today`. Confirm the page renders matches normally and the server log shows `[tier-visibility] read failed, hiding nothing:` once per minute at most, with no 500 from `/api/matches/by-date` or `/api/matches/calendar`.

- [ ] **Step 2: Filter check — force a hidden list locally**

Temporarily (do NOT commit) set an env override by editing nothing in prod: in `src/lib/tier-visibility.ts` locally prepend to `fetchMatchesHiddenTiers`:

```ts
  if (process.env.TIER_VISIBILITY_DEV_HIDDEN) return process.env.TIER_VISIBILITY_DEV_HIDDEN.split(',')
```

Run the dev server with `TIER_VISIBILITY_DEV_HIDDEN=fip_bronze` (Bronze always has matches). Confirm:
1. `/matches/<a recent date with Bronze matches>` shows no FIP Bronze group; other tiers present.
2. That Bronze tournament's `/tournaments/<id>` page still lists its matches.
3. Home page unchanged.
4. Switch days via the pills — `/api/matches/by-date` responses contain no `fip_bronze`.

Then **revert the override**: `git diff src/lib/tier-visibility.ts` must be empty before moving on.

- [ ] **Step 3: Admin page renders**

Start `apps/ops` dev server, sign in as operator, open `/system/tier-visibility`. With the table absent, GET 500s → confirm the error EmptyState + Retry render cleanly (expected until migration). Screenshot for Gustavo.

- [ ] **Step 4: Full test sweep**

```bash
cd /Volumes/Crucial/dev/padel-tier-visibility && npx vitest run src/lib/__tests__/tier-visibility.test.ts src/lib/__tests__/fetch-matches-day-tiers.test.ts src/lib/__tests__/fetch-matches-calendar.test.ts && cd apps/ops && npx vitest run src/app/api/internal/tier-visibility
```

Expected: all green.

- [ ] **Step 5: Stop and report to Gustavo**

Report: what was verified, screenshots, and the remaining go-live steps that need his approval:
1. Apply `20261003120000_tier_visibility.sql` via pg + `DATABASE_URL` (Promises + Beyond hidden immediately on apply).
2. Merge + deploy web app and admin (`railway up` from `apps/ops`).
3. Flip-off / flip-on round trip in the prod admin, confirming /matches follows within ~2 min.
