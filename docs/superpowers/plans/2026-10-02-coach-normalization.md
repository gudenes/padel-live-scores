# Coach Normalization + Admin Coaches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the free-text `players.coaches` strings into canonical coach records, with a padelgod worker that keeps them linked and an admin UI (inside the Players tab) to review, merge, junk and link coaches to players.

**Architecture:** `players.coaches` stays the raw FIP field. A new padelgod worker `coach-linker` maps each raw string → `coach_aliases` → `coaches`, rebuilds `player_coaches`, and writes *suggestions only* for fuzzy merges and coach↔player links. Merges run through one Postgres function (`merge_coaches`) so they are atomic. The admin (`apps/ops`) reads a `coach_stats` view and calls small internal API routes.

**Tech Stack:** Postgres (Supabase), padelgod (Node 20, TypeScript ESM, vitest, supabase-js), apps/ops (Next.js 16 App Router, React 19, Auth.js, vitest).

**Spec:** `docs/superpowers/specs/2026-10-02-coach-normalization-design.md`

**Ground rules for the implementer**
- Work ONLY inside the worktree `/Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/coach-normalization`. Never `cd` to the main repo dir (other sessions switch its branch).
- **No production writes without Gustavo's explicit go-ahead.** That covers: applying the migration, running the linker non-dry-run, running the seed script, and any deploy. Tasks that touch prod say so and stop for confirmation.
- padelgod tests: `cd padelgod && npx vitest run <path>`. Test files must live under `src/**/__tests__/**/*.test.ts` (vitest include glob).
- apps/ops tests: `cd apps/ops && npx vitest run <path>`.
- If `node_modules` is missing in the worktree, run `npm install` in `padelgod/` and `apps/ops/` (real install, not a symlink).

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261002_coaches.sql` | 5 tables, `coach_stats` view, `merge_coaches()` function, RLS, ASSERTs |
| `padelgod/src/lib/coach-normalize.ts` | Pure: `normalizeCoachName`, `coachTokens`, `slugifyCoach`, `uniqueSlug` |
| `padelgod/src/lib/coach-suggestions.ts` | Pure: merge-suggestion + player-link-suggestion generators |
| `padelgod/src/lib/coach-link-planner.ts` | Pure: given DB state, compute coaches/aliases/links to write |
| `padelgod/src/workers/coach-linker.ts` | DB IO around the three pure modules; dry-run; batch error isolation |
| `padelgod/src/scheduler.ts`, `src/lib/env.ts`, `src/index.ts` | Flag + schedule wiring |
| `apps/ops/src/lib/coaches.ts` | Shared types + `validateCoachPatch` + `sortByImpact` |
| `apps/ops/src/app/api/internal/coaches/**` | list, detail GET/PATCH, merge, suggestions, reject, player-link |
| `apps/ops/src/app/(app)/players/_components/PlayersViews.tsx` | Players · Coaches · Review queue switch |
| `apps/ops/src/app/(app)/players/_components/CoachesView.tsx` | Coach list (internal coach ranking) |
| `apps/ops/src/app/(app)/players/_components/CoachReviewQueue.tsx` | Merge + player-link suggestions |
| `apps/ops/src/app/(app)/players/coaches/[id]/**` | Coach detail page |
| `apps/ops/src/app/api/internal/search-players/route.ts`, `PlayersTable.tsx`, `types.ts` | **Coach** tag on player rows |
| `apps/ops/src/app/api/internal/player/[id]/route.ts`, `CoachesSection.tsx`, `PlayerProfile.tsx` | Coach links + **Coach** tag on player detail |
| `apps/ops/src/app/api/internal/search/route.ts`, `apps/ops/src/lib/command-palette.ts` | ⌘K coach hits |
| `scripts/seed-coach-decisions.ts` | One-shot: record the 2026-09-18 merge/reject decisions |

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261002_coaches.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Coach normalization (spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md)
-- players.coaches (TEXT[]) stays the raw FIP field. Everything here is derived
-- from it by padelgod's coach-linker worker, plus operator decisions.

create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  slug text not null unique,
  status text not null default 'unreviewed'
    check (status in ('unreviewed','verified','junk','merged')),
  merged_into uuid references public.coaches(id),
  country text,
  avatar_url text,
  notes text,
  player_id uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'merged') = (merged_into is not null))
);
create unique index if not exists coaches_normalized_name_active
  on public.coaches(normalized_name) where status <> 'merged';
create unique index if not exists coaches_player_id_unique
  on public.coaches(player_id) where player_id is not null;

create table if not exists public.coach_aliases (
  normalized_alias text primary key,
  coach_id uuid not null references public.coaches(id),
  example_raw text not null,
  source text not null default 'auto' check (source in ('auto','merge')),
  created_at timestamptz not null default now()
);
create index if not exists coach_aliases_coach_id on public.coach_aliases(coach_id);

create table if not exists public.player_coaches (
  player_id uuid not null references public.players(id) on delete cascade,
  coach_id uuid not null references public.coaches(id),
  raw_name text not null,
  position smallint not null,
  primary key (player_id, coach_id)
);
create index if not exists player_coaches_coach_id on public.player_coaches(coach_id);

create table if not exists public.coach_merge_suggestions (
  id uuid primary key default gen_random_uuid(),
  coach_a uuid not null references public.coaches(id),
  coach_b uuid not null references public.coaches(id),
  score numeric not null,
  reason text not null check (reason in ('subset','typo','manual')),
  status text not null default 'pending' check (status in ('pending','merged','rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (coach_a < coach_b),
  unique (coach_a, coach_b)
);

create table if not exists public.coach_player_link_suggestions (
  coach_id uuid not null references public.coaches(id),
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','linked','rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (coach_id, player_id)
);

alter table public.coaches enable row level security;
alter table public.coach_aliases enable row level security;
alter table public.player_coaches enable row level security;
alter table public.coach_merge_suggestions enable row level security;
alter table public.coach_player_link_suggestions enable row level security;
-- No anon policy in Phase 1: service key only. Phase 2 (public pages) adds read policies.

-- Per-coach aggregates. Excludes merged coaches; junk is kept (admin filters it).
-- player_coaches PK (player_id, coach_id) guarantees each player counts once per coach.
create or replace view public.coach_stats with (security_invoker = true) as
select
  c.id as coach_id,
  c.display_name,
  c.slug,
  c.status,
  c.player_id,
  count(p.id)::int as player_count,
  coalesce(sum(p.points) filter (where p.category = 'men'), 0)::numeric as men_points,
  coalesce(sum(p.points) filter (where p.category = 'women'), 0)::numeric as women_points,
  coalesce(sum(p.points), 0)::numeric as total_points,
  (select count(*) from public.coach_aliases a where a.coach_id = c.id)::int as variant_count
from public.coaches c
left join public.player_coaches pc on pc.coach_id = c.id
left join public.players p on p.id = pc.player_id and coalesce(p.tier, 'pro') = 'pro'
where c.status <> 'merged'
group by c.id;

-- Atomic merge: everything of p_source moves onto p_target.
create or replace function public.merge_coaches(
  p_source uuid,
  p_target uuid,
  p_keep_source_name boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.coaches;
  t public.coaches;
begin
  if p_source = p_target then
    raise exception 'merge_coaches: source and target are the same coach';
  end if;
  select * into s from public.coaches where id = p_source for update;
  select * into t from public.coaches where id = p_target for update;
  if s.id is null or t.id is null then
    raise exception 'merge_coaches: coach not found';
  end if;
  if s.status = 'merged' or t.status = 'merged' then
    raise exception 'merge_coaches: coach already merged';
  end if;

  update public.coach_aliases set coach_id = p_target, source = 'merge' where coach_id = p_source;

  insert into public.player_coaches (player_id, coach_id, raw_name, position)
    select player_id, p_target, raw_name, position from public.player_coaches where coach_id = p_source
    on conflict (player_id, coach_id) do nothing;
  delete from public.player_coaches where coach_id = p_source;

  -- Record the merge decision for this pair (insert if it was a manual merge).
  insert into public.coach_merge_suggestions (coach_a, coach_b, score, reason, status, decided_at)
    values (least(p_source, p_target), greatest(p_source, p_target), 1, 'manual', 'merged', now())
    on conflict (coach_a, coach_b) do update set status = 'merged', decided_at = now();

  -- Carry "not the same person" decisions over to the target so they are never re-suggested.
  insert into public.coach_merge_suggestions (coach_a, coach_b, score, reason, status, decided_at)
    select least(p_target, x.other), greatest(p_target, x.other), x.score, x.reason, 'rejected', x.decided_at
    from (
      select case when coach_a = p_source then coach_b else coach_a end as other, score, reason, decided_at
      from public.coach_merge_suggestions
      where status = 'rejected' and (coach_a = p_source or coach_b = p_source)
    ) x
    where x.other <> p_target
    on conflict (coach_a, coach_b) do update set status = 'rejected', decided_at = excluded.decided_at;

  -- Drop the source's remaining pending/rejected rows; the linker regenerates pending ones against the target.
  delete from public.coach_merge_suggestions
    where status in ('pending','rejected') and (coach_a = p_source or coach_b = p_source);
  delete from public.coach_player_link_suggestions where coach_id = p_source and status = 'pending';

  update public.coaches
    set status = 'merged', merged_into = p_target, player_id = null, updated_at = now()
    where id = p_source;

  update public.coaches
    set display_name = case when p_keep_source_name then s.display_name else display_name end,
        player_id = coalesce(player_id, s.player_id),
        updated_at = now()
    where id = p_target;
end;
$$;

revoke all on function public.merge_coaches(uuid, uuid, boolean) from public, anon, authenticated;

do $$
begin
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coaches'), 'coaches missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_aliases'), 'coach_aliases missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='player_coaches'), 'player_coaches missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_merge_suggestions'), 'coach_merge_suggestions missing';
  assert exists (select 1 from information_schema.tables where table_schema='public' and table_name='coach_player_link_suggestions'), 'coach_player_link_suggestions missing';
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_stats'), 'coach_stats missing';
  assert exists (select 1 from pg_proc where proname='merge_coaches'), 'merge_coaches missing';
end $$;
```

- [ ] **Step 2: Write a rollback-only verification script**

Create `scripts/verify-coaches-migration.ts`. It runs the migration + a merge scenario inside one transaction and **always rolls back**, so it is safe against prod (it never commits).

```ts
// Verifies supabase/migrations/20261002_coaches.sql inside a transaction that is
// ALWAYS rolled back. Safe to run against prod: nothing is committed.
//   npx tsx scripts/verify-coaches-migration.ts
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('begin')
    await c.query(readFileSync('supabase/migrations/20261002_coaches.sql', 'utf8'))
    const ins = async (name: string) =>
      (await c.query(
        `insert into coaches (display_name, normalized_name, slug) values ($1, $2, $3) returning id`,
        [name, name.toLowerCase(), name.toLowerCase().replace(/\s+/g, '-')],
      )).rows[0].id as string
    const a = await ins('Agustin Silingo')
    const b = await ins('Agustin Gomez Silingo')
    const x = await ins('Somebody Else')
    await c.query(`insert into coach_aliases (normalized_alias, coach_id, example_raw) values ('agustin silingo', $1, 'Agustin Silingo')`, [a])
    const [lo, hi] = [a, x].sort()
    await c.query(`insert into coach_merge_suggestions (coach_a, coach_b, score, reason, status) values ($1, $2, 1, 'subset', 'rejected')`, [lo, hi])
    await c.query(`select merge_coaches($1, $2, false)`, [a, b])

    const alias = (await c.query(`select coach_id, source from coach_aliases where normalized_alias = 'agustin silingo'`)).rows[0]
    const src = (await c.query(`select status, merged_into from coaches where id = $1`, [a])).rows[0]
    const carried = (await c.query(
      `select status from coach_merge_suggestions where coach_a = least($1::uuid, $2::uuid) and coach_b = greatest($1::uuid, $2::uuid)`, [b, x])).rows[0]
    const ok = alias.coach_id === b && alias.source === 'merge' && src.status === 'merged' && src.merged_into === b && carried?.status === 'rejected'
    console.log({ alias, src, carried, ok })
    let selfErr = ''
    try { await c.query('savepoint s'); await c.query(`select merge_coaches($1, $1)`, [b]) } catch (e) { selfErr = (e as Error).message; await c.query('rollback to savepoint s') }
    console.log({ selfMergeRejected: selfErr.includes('same coach') })
    if (!ok || !selfErr.includes('same coach')) process.exitCode = 1
  } finally {
    await c.query('rollback')
    await c.end()
  }
}
main()
```

- [ ] **Step 3: Run it (rollback-only, safe)**

Run (from the worktree root; `.env.local` must be copied in from the main checkout first — `cp ../../../.env.local .`, it is gitignored):
```bash
set -a; source .env.local; set +a; npx tsx scripts/verify-coaches-migration.ts
```
Expected: `{ ..., ok: true }` and `{ selfMergeRejected: true }`, exit code 0. If `pg` isn't resolvable from the scripts dir, run with `NODE_PATH=apps/ops/node_modules`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261002_coaches.sql scripts/verify-coaches-migration.ts
git commit -m "feat(coaches): coaches schema, coach_stats view, merge_coaches()"
```

**Do NOT apply the migration to prod here.** It is applied in Task 14 after Gustavo confirms.

---

### Task 2: Coach name normalizer (padelgod, pure)

**Files:**
- Create: `padelgod/src/lib/coach-normalize.ts`
- Test: `padelgod/src/__tests__/lib/coach-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeCoachName, coachTokens, slugifyCoach, uniqueSlug } from '../../lib/coach-normalize.js'

describe('normalizeCoachName', () => {
  it('strips accents and case', () => {
    expect(normalizeCoachName('Fábio Faísca')).toBe('fabio faisca')
    expect(normalizeCoachName('Fabio Faisca')).toBe('fabio faisca')
  })
  it('removes apostrophes instead of splitting on them', () => {
    expect(normalizeCoachName('Martín D’antonio')).toBe('martin dantonio')
    expect(normalizeCoachName("Kevin O'brien")).toBe('kevin obrien')
    expect(normalizeCoachName('Kevin O’brien')).toBe('kevin obrien')
  })
  it('collapses whitespace and punctuation', () => {
    expect(normalizeCoachName('  Alejandro  Del Moral ')).toBe('alejandro del moral')
    expect(normalizeCoachName('Juan-José Mieres')).toBe('juan jose mieres')
  })
  it('returns empty string for punctuation-only input', () => {
    expect(normalizeCoachName(' - ')).toBe('')
  })
})

describe('coachTokens', () => {
  it('drops 1-char tokens', () => {
    expect(coachTokens('sandy f')).toEqual(['sandy'])
    expect(coachTokens('juan jose gutierrez')).toEqual(['juan', 'jose', 'gutierrez'])
  })
})

describe('slugifyCoach / uniqueSlug', () => {
  it('slugifies', () => {
    expect(slugifyCoach('Agustín Gómez Silingo')).toBe('agustin-gomez-silingo')
  })
  it('dedupes against taken slugs', () => {
    const taken = new Set(['juan-alday', 'juan-alday-2'])
    expect(uniqueSlug('juan-alday', taken)).toBe('juan-alday-3')
    expect(taken.has('juan-alday-3')).toBe(true)
    expect(uniqueSlug('pablo-pesce', taken)).toBe('pablo-pesce')
  })
  it('falls back to "coach" for an empty slug', () => {
    expect(uniqueSlug(slugifyCoach('-'), new Set())).toBe('coach')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/lib/coach-normalize.test.ts`
Expected: FAIL — cannot find module `../../lib/coach-normalize.js`.

- [ ] **Step 3: Implement**

```ts
// padelgod/src/lib/coach-normalize.ts
//
// Coach-name normalization. Same as db-resolver's normalizeName, except
// apostrophes are REMOVED before punctuation→space, so "D’antonio" and
// "Dantonio" collapse to the same key (dry run 2026-10-02: they didn't).
// Spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md

const APOSTROPHES = /['’‘`´]/g

export function normalizeCoachName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(APOSTROPHES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Tokens of an already-normalized name, ignoring 1-char tokens (initials). */
export function coachTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length > 1)
}

export function slugifyCoach(displayName: string): string {
  return normalizeCoachName(displayName).replace(/ /g, '-')
}

/** Returns a slug not in `taken` (base, base-2, base-3, …) and adds it to `taken`. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = base || 'coach'
  let slug = root
  for (let n = 2; taken.has(slug); n++) slug = `${root}-${n}`
  taken.add(slug)
  return slug
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/lib/coach-normalize.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/coach-normalize.ts padelgod/src/__tests__/lib/coach-normalize.test.ts
git commit -m "feat(coaches): coach name normalizer"
```

---

### Task 3: Suggestion generators (padelgod, pure)

**Files:**
- Create: `padelgod/src/lib/coach-suggestions.ts`
- Test: `padelgod/src/__tests__/lib/coach-suggestions.test.ts`

Reuses `subsetSimilarity` / `typoTolerantSimilarity` exported by `padelgod/src/lib/db-resolver.ts` (do not copy them).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  pairKey,
  generateMergeSuggestions,
  generatePlayerLinkSuggestions,
  type SuggestionCoach,
} from '../../lib/coach-suggestions.js'

const c = (id: string, normalized_name: string, extra: Partial<SuggestionCoach> = {}): SuggestionCoach => ({
  id, normalized_name, status: 'unreviewed', player_id: null, ...extra,
})

describe('pairKey', () => {
  it('orders ids', () => {
    expect(pairKey('b', 'a')).toBe('a|b')
    expect(pairKey('a', 'b')).toBe('a|b')
  })
})

describe('generateMergeSuggestions', () => {
  it('suggests subset matches with score 1', () => {
    const out = generateMergeSuggestions([c('1', 'juan cabrera'), c('2', 'juan cabrera gomez')], new Set())
    expect(out).toEqual([{ coach_a: '1', coach_b: '2', score: 1, reason: 'subset' }])
  })
  it('suggests one-letter typos', () => {
    const out = generateMergeSuggestions([c('1', 'pablo crosseti'), c('2', 'pablo crossetti')], new Set())
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('typo')
  })
  it('surfaces Juan Gutierrez / Juan Jose Gutierrez only as a suggestion (never a merge)', () => {
    const out = generateMergeSuggestions([c('1', 'juan gutierrez'), c('2', 'juan jose gutierrez')], new Set())
    expect(out).toEqual([{ coach_a: '1', coach_b: '2', score: 1, reason: 'subset' }])
  })
  it('never pairs single-token names', () => {
    const out = generateMergeSuggestions(
      [c('1', 'manual'), c('2', 'manuel zamora aguilar'), c('3', 'juan'), c('4', 'juan restivo')],
      new Set(),
    )
    expect(out).toEqual([])
  })
  it('skips pairs that already have a row (pending, rejected or merged)', () => {
    const out = generateMergeSuggestions([c('1', 'juan gutierrez'), c('2', 'juan jose gutierrez')], new Set(['1|2']))
    expect(out).toEqual([])
  })
  it('skips junk and merged coaches', () => {
    const out = generateMergeSuggestions(
      [c('1', 'juan cabrera', { status: 'junk' }), c('2', 'juan cabrera gomez'), c('3', 'juan cabrera gome', { status: 'merged' })],
      new Set(),
    )
    expect(out).toEqual([])
  })
  it('with onlyIds, compares only pairs touching those ids', () => {
    const coaches = [c('1', 'borja lopez'), c('2', 'borja lopez vidal'), c('3', 'adrian espinosa'), c('4', 'adrian espinosa cruz')]
    const out = generateMergeSuggestions(coaches, new Set(), new Set(['4']))
    expect(out.map((s) => pairKey(s.coach_a, s.coach_b))).toEqual(['3|4'])
  })
})

describe('generatePlayerLinkSuggestions', () => {
  const players = [
    { id: 'p1', normalized_name: 'gaby reca' },
    { id: 'p2', normalized_name: 'juan alday' },
  ]
  it('suggests an exact normalized-name match', () => {
    const out = generatePlayerLinkSuggestions([c('c1', 'gaby reca')], players, new Set(), new Set())
    expect(out).toEqual([{ coach_id: 'c1', player_id: 'p1' }])
  })
  it('does not suggest when the coach is already linked, junk, or single-token', () => {
    const out = generatePlayerLinkSuggestions(
      [c('c1', 'gaby reca', { player_id: 'p1' }), c('c2', 'juan alday', { status: 'junk' }), c('c3', 'reca')],
      players, new Set(), new Set(),
    )
    expect(out).toEqual([])
  })
  it('skips existing suggestion rows and players already linked to another coach', () => {
    const out = generatePlayerLinkSuggestions(
      [c('c1', 'gaby reca'), c('c2', 'juan alday')],
      players, new Set(['c1|p1']), new Set(['p2']),
    )
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/lib/coach-suggestions.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// padelgod/src/lib/coach-suggestions.ts
//
// Fuzzy matching for coaches produces SUGGESTIONS ONLY — never an alias or
// a merge. Lesson from d59a7206c (Momo González conflation): fuzzy matches
// that auto-write aliases glue different people together, and coaches have
// no category/country/ranking to tell them apart.

import { subsetSimilarity, typoTolerantSimilarity } from './db-resolver.js'
import { coachTokens } from './coach-normalize.js'

export interface SuggestionCoach {
  id: string
  normalized_name: string
  status: 'unreviewed' | 'verified' | 'junk' | 'merged'
  player_id: string | null
}

export interface MergeSuggestion {
  coach_a: string
  coach_b: string
  score: number
  reason: 'subset' | 'typo'
}

export interface PlayerLinkSuggestion {
  coach_id: string
  player_id: string
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

const TYPO_THRESHOLD = 0.99

function eligible(c: SuggestionCoach): boolean {
  return c.status !== 'junk' && c.status !== 'merged' && coachTokens(c.normalized_name).length >= 2
}

/**
 * @param existingPairs pairKey() of every coach_merge_suggestions row, any status
 * @param onlyIds when set, only pairs where at least one side is in this set are compared
 */
export function generateMergeSuggestions(
  coaches: SuggestionCoach[],
  existingPairs: Set<string>,
  onlyIds?: Set<string>,
): MergeSuggestion[] {
  const pool = coaches.filter(eligible)
  const out: MergeSuggestion[] = []
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const x = pool[i]
      const y = pool[j]
      if (onlyIds && !onlyIds.has(x.id) && !onlyIds.has(y.id)) continue
      const key = pairKey(x.id, y.id)
      if (existingPairs.has(key)) continue
      const [coach_a, coach_b] = key.split('|')
      if (subsetSimilarity(x.normalized_name, y.normalized_name) === 1) {
        out.push({ coach_a, coach_b, score: 1, reason: 'subset' })
        continue
      }
      const typo = typoTolerantSimilarity(x.normalized_name, y.normalized_name)
      if (typo >= TYPO_THRESHOLD) out.push({ coach_a, coach_b, score: Number(typo.toFixed(3)), reason: 'typo' })
    }
  }
  return out
}

/**
 * Exact normalized-name match between an unlinked coach and a player.
 * @param existingPairs `${coach_id}|${player_id}` of every coach_player_link_suggestions row, any status
 * @param linkedPlayerIds players already set as some coach's player_id
 */
export function generatePlayerLinkSuggestions(
  coaches: SuggestionCoach[],
  players: { id: string; normalized_name: string }[],
  existingPairs: Set<string>,
  linkedPlayerIds: Set<string>,
): PlayerLinkSuggestion[] {
  const byName = new Map<string, string[]>()
  for (const p of players) {
    if (!p.normalized_name) continue
    const ids = byName.get(p.normalized_name)
    if (ids) ids.push(p.id)
    else byName.set(p.normalized_name, [p.id])
  }
  const out: PlayerLinkSuggestion[] = []
  for (const c of coaches) {
    if (!eligible(c) || c.player_id) continue
    for (const playerId of byName.get(c.normalized_name) ?? []) {
      if (linkedPlayerIds.has(playerId)) continue
      if (existingPairs.has(`${c.id}|${playerId}`)) continue
      out.push({ coach_id: c.id, player_id: playerId })
    }
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/lib/coach-suggestions.test.ts`
Expected: PASS. If the typo test fails, print `typoTolerantSimilarity('pablo crosseti','pablo crossetti')` — it must be 1 (1-char edit on a ≥4-char token). Do not lower the threshold to make other pairs pass.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/coach-suggestions.ts padelgod/src/__tests__/lib/coach-suggestions.test.ts
git commit -m "feat(coaches): merge + player-link suggestion generators"
```

---

### Task 4: Link planner (padelgod, pure)

**Files:**
- Create: `padelgod/src/lib/coach-link-planner.ts`
- Test: `padelgod/src/__tests__/lib/coach-link-planner.test.ts`

The planner takes everything already loaded from the DB and returns exactly what to write. All decisions live here so they are unit-testable; the worker only does IO.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { planCoachLinks, type PlannerInput } from '../../lib/coach-link-planner.js'

function ids() {
  let n = 0
  return () => `new-${++n}`
}

const empty = (): PlannerInput => ({
  players: [],
  coaches: [],
  aliases: [],
  existingLinks: [],
})

describe('planCoachLinks', () => {
  it('creates one coach for accent/apostrophe variants and links both players', () => {
    const input = empty()
    input.players = [
      { id: 'p1', coaches: ['Martín D’antonio'] },
      { id: 'p2', coaches: ['Martin Dantonio'] },
    ]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([
      { id: 'new-1', display_name: 'Martín D’antonio', normalized_name: 'martin dantonio', slug: 'martin-dantonio', notes: null },
    ])
    expect(plan.newAliases).toEqual([
      { normalized_alias: 'martin dantonio', coach_id: 'new-1', example_raw: 'Martín D’antonio', source: 'auto' },
    ])
    expect(plan.linksToUpsert).toEqual([
      { player_id: 'p1', coach_id: 'new-1', raw_name: 'Martín D’antonio', position: 0 },
      { player_id: 'p2', coach_id: 'new-1', raw_name: 'Martin Dantonio', position: 0 },
    ])
    expect(plan.linksToDelete).toEqual([])
  })

  it('uses an existing alias, following merged_into', () => {
    const input = empty()
    input.coaches = [
      { id: 'old', normalized_name: 'agustin silingo', display_name: 'Agustin Silingo', slug: 'agustin-silingo', status: 'merged', merged_into: 'keep' },
      { id: 'keep', normalized_name: 'agustin gomez silingo', display_name: 'Agustín Gómez Silingo', slug: 'agustin-gomez-silingo', status: 'verified', merged_into: null },
    ]
    input.aliases = [{ normalized_alias: 'agustin silingo', coach_id: 'old' }]
    input.players = [{ id: 'p1', coaches: ['Agustín Silingo'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.newAliases).toEqual([])
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 'keep', raw_name: 'Agustín Silingo', position: 0 }])
    expect(plan.counts.aliasHits).toBe(1)
  })

  it('adds an auto alias when a coach with that normalized name exists but the alias row does not', () => {
    const input = empty()
    input.coaches = [{ id: 'c1', normalized_name: 'pablo pesce', display_name: 'Pablo Pesce', slug: 'pablo-pesce', status: 'unreviewed', merged_into: null }]
    input.players = [{ id: 'p1', coaches: ['Pablo Pesce'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.newAliases).toEqual([{ normalized_alias: 'pablo pesce', coach_id: 'c1', example_raw: 'Pablo Pesce', source: 'auto' }])
  })

  it('is idempotent: a second run over its own output writes nothing', () => {
    const input = empty()
    input.players = [{ id: 'p1', coaches: ['Gustavo Pratto', 'Martin Canali'] }]
    const first = planCoachLinks(input, ids())
    const second = planCoachLinks(
      {
        players: input.players,
        coaches: first.newCoaches.map((c) => ({ ...c, status: 'unreviewed' as const, merged_into: null })),
        aliases: first.newAliases.map((a) => ({ normalized_alias: a.normalized_alias, coach_id: a.coach_id })),
        existingLinks: first.linksToUpsert,
      },
      ids(),
    )
    expect(second.newCoaches).toEqual([])
    expect(second.newAliases).toEqual([])
    expect(second.linksToUpsert).toEqual([])
    expect(second.linksToDelete).toEqual([])
  })

  it('deletes links the player no longer lists, including players whose list became empty', () => {
    const input = empty()
    input.coaches = [
      { id: 'c1', normalized_name: 'old coach', display_name: 'Old Coach', slug: 'old-coach', status: 'unreviewed', merged_into: null },
    ]
    input.aliases = [{ normalized_alias: 'old coach', coach_id: 'c1' }]
    input.existingLinks = [
      { player_id: 'p1', coach_id: 'c1', raw_name: 'Old Coach', position: 0 },
      { player_id: 'p2', coach_id: 'c1', raw_name: 'Old Coach', position: 0 },
    ]
    input.players = [{ id: 'p1', coaches: ['New Coach'] }, { id: 'p2', coaches: [] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToDelete).toEqual([
      { player_id: 'p1', coach_id: 'c1' },
      { player_id: 'p2', coach_id: 'c1' },
    ])
  })

  it('rewrites a link whose raw spelling or position changed', () => {
    const input = empty()
    input.coaches = [{ id: 'c1', normalized_name: 'iñigo lopez'.normalize('NFD').replace(/[̀-ͯ]/g, ''), display_name: 'Iñigo Lopez', slug: 'inigo-lopez', status: 'unreviewed', merged_into: null }]
    input.aliases = [{ normalized_alias: 'inigo lopez', coach_id: 'c1' }]
    input.existingLinks = [{ player_id: 'p1', coach_id: 'c1', raw_name: 'Iñigo Lopez', position: 0 }]
    input.players = [{ id: 'p1', coaches: ['Iñigo López'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 'c1', raw_name: 'Iñigo López', position: 0 }])
  })

  it('keeps junk coaches resolving (junk is a status, not a deletion)', () => {
    const input = empty()
    input.coaches = [{ id: 'j', normalized_name: 'manual', display_name: 'Manual', slug: 'manual', status: 'junk', merged_into: null }]
    input.aliases = [{ normalized_alias: 'manual', coach_id: 'j' }]
    input.players = [{ id: 'p1', coaches: ['Manual'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 'j', raw_name: 'Manual', position: 0 }])
  })

  it('flags single-token names and dedupes slugs', () => {
    const input = empty()
    input.coaches = [{ id: 'c1', normalized_name: 'juan alday x', display_name: 'X', slug: 'juan', status: 'unreviewed', merged_into: null }]
    input.players = [{ id: 'p1', coaches: ['Juan'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches[0].slug).toBe('juan-2')
    expect(plan.newCoaches[0].notes).toBe('single-token name — check if junk')
  })

  it('links a coach once per player even if listed twice under two spellings', () => {
    const input = empty()
    input.players = [{ id: 'p1', coaches: ['Matías Díaz', 'Matias Diaz'] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.linksToUpsert).toEqual([{ player_id: 'p1', coach_id: 'new-1', raw_name: 'Matías Díaz', position: 0 }])
  })

  it('skips raw strings that normalize to empty', () => {
    const input = empty()
    input.players = [{ id: 'p1', coaches: [' - '] }]
    const plan = planCoachLinks(input, ids())
    expect(plan.newCoaches).toEqual([])
    expect(plan.linksToUpsert).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/lib/coach-link-planner.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// padelgod/src/lib/coach-link-planner.ts
//
// Pure core of the coach-linker worker. Resolution chain per raw string:
//   1. coach_aliases hit (follow merged_into)        → that coach
//   2. a non-merged coach with the same normalized name → that coach + new 'auto' alias
//   3. otherwise                                        → new 'unreviewed' coach + 'auto' alias
// Fuzzy matching is NOT here — it only produces suggestions (coach-suggestions.ts).

import { normalizeCoachName, coachTokens, slugifyCoach, uniqueSlug } from './coach-normalize.js'

export type CoachStatus = 'unreviewed' | 'verified' | 'junk' | 'merged'

export interface PlannerCoach {
  id: string
  normalized_name: string
  display_name: string
  slug: string
  status: CoachStatus
  merged_into: string | null
}

export interface PlayerCoachLink {
  player_id: string
  coach_id: string
  raw_name: string
  position: number
}

export interface PlannerInput {
  /** Every player with a non-empty coaches array, plus every player that currently has links. */
  players: { id: string; coaches: string[] }[]
  coaches: PlannerCoach[]
  aliases: { normalized_alias: string; coach_id: string }[]
  existingLinks: PlayerCoachLink[]
}

export interface NewCoach {
  id: string
  display_name: string
  normalized_name: string
  slug: string
  notes: string | null
}

export interface NewAlias {
  normalized_alias: string
  coach_id: string
  example_raw: string
  source: 'auto'
}

export interface CoachLinkPlan {
  newCoaches: NewCoach[]
  newAliases: NewAlias[]
  linksToUpsert: PlayerCoachLink[]
  linksToDelete: { player_id: string; coach_id: string }[]
  counts: { rawStrings: number; aliasHits: number }
}

export const SINGLE_TOKEN_NOTE = 'single-token name — check if junk'

export function planCoachLinks(input: PlannerInput, newId: () => string): CoachLinkPlan {
  const coachById = new Map(input.coaches.map((c) => [c.id, c]))
  const activeByName = new Map(
    input.coaches.filter((c) => c.status !== 'merged').map((c) => [c.normalized_name, c.id]),
  )
  const aliasMap = new Map(input.aliases.map((a) => [a.normalized_alias, a.coach_id]))
  const takenSlugs = new Set(input.coaches.map((c) => c.slug))

  const newCoaches: NewCoach[] = []
  const newAliases: NewAlias[] = []
  let rawStrings = 0
  let aliasHits = 0

  const follow = (id: string): string => {
    let cur = id
    for (let hops = 0; hops < 10; hops++) {
      const c = coachById.get(cur)
      if (!c || c.status !== 'merged' || !c.merged_into) return cur
      cur = c.merged_into
    }
    return cur
  }

  const resolve = (raw: string): string | null => {
    const norm = normalizeCoachName(raw)
    if (!norm) return null
    rawStrings++
    const aliased = aliasMap.get(norm)
    if (aliased) {
      aliasHits++
      return follow(aliased)
    }
    let coachId = activeByName.get(norm)
    if (!coachId) {
      coachId = newId()
      newCoaches.push({
        id: coachId,
        display_name: raw.trim().replace(/\s+/g, ' '),
        normalized_name: norm,
        slug: uniqueSlug(slugifyCoach(raw), takenSlugs),
        notes: coachTokens(norm).length < 2 ? SINGLE_TOKEN_NOTE : null,
      })
      activeByName.set(norm, coachId)
    }
    aliasMap.set(norm, coachId)
    newAliases.push({ normalized_alias: norm, coach_id: coachId, example_raw: raw.trim(), source: 'auto' })
    return coachId
  }

  const existingByKey = new Map(input.existingLinks.map((l) => [`${l.player_id}|${l.coach_id}`, l]))
  const desiredKeys = new Set<string>()
  const linksToUpsert: PlayerCoachLink[] = []

  for (const p of input.players) {
    const seen = new Set<string>()
    p.coaches.forEach((raw, position) => {
      const coachId = resolve(raw)
      if (!coachId || seen.has(coachId)) return
      seen.add(coachId)
      const key = `${p.id}|${coachId}`
      desiredKeys.add(key)
      const prev = existingByKey.get(key)
      if (!prev || prev.raw_name !== raw || prev.position !== position) {
        linksToUpsert.push({ player_id: p.id, coach_id: coachId, raw_name: raw, position })
      }
    })
  }

  const linksToDelete = input.existingLinks
    .filter((l) => !desiredKeys.has(`${l.player_id}|${l.coach_id}`))
    .map((l) => ({ player_id: l.player_id, coach_id: l.coach_id }))

  return { newCoaches, newAliases, linksToUpsert, linksToDelete, counts: { rawStrings, aliasHits } }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/lib/coach-link-planner.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/coach-link-planner.ts padelgod/src/__tests__/lib/coach-link-planner.test.ts
git commit -m "feat(coaches): pure coach link planner"
```

---

### Task 5: `coach-linker` worker (padelgod, IO)

**Files:**
- Create: `padelgod/src/workers/coach-linker.ts`

The worker loads state, calls the planner + generators, and writes in chunks. No new tests here beyond the pure modules: the IO is a straight-line load/write and is verified by the dry run in Task 14 against real data. (Consistent with other workers whose pure builders are tested and IO is not.)

- [ ] **Step 1: Implement**

```ts
// padelgod/src/workers/coach-linker.ts
//
// Maps players.coaches (raw FIP strings) onto canonical coaches.
// Spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md
//
// Writes: coaches, coach_aliases, player_coaches, coach_merge_suggestions,
// coach_player_link_suggestions. NEVER auto-merges fuzzy matches and NEVER
// sets coaches.player_id — both are operator decisions in the admin.
//
// Each write chunk is isolated: one failing chunk is counted in batchErrors
// and the rest of the run continues (lesson from the fip-draw-populator
// whole-batch abort). A failed chunk is self-healing: the next run re-plans
// from DB state.

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { paginatedSelect } from '../lib/db-paginate.js'
import { normalizeCoachName } from '../lib/coach-normalize.js'
import { planCoachLinks, type PlannerCoach, type PlayerCoachLink } from '../lib/coach-link-planner.js'
import {
  generateMergeSuggestions,
  generatePlayerLinkSuggestions,
  pairKey,
  type SuggestionCoach,
} from '../lib/coach-suggestions.js'

export interface CoachLinkerDeps {
  supabase: SupabaseClient
  logger: Logger
  dryRun: boolean
}

export interface CoachLinkerResult {
  dryRun: boolean
  playersScanned: number
  rawStrings: number
  aliasHits: number
  autoAliases: number
  coachesCreated: number
  playerLinksWritten: number
  playerLinksDeleted: number
  suggestionsCreated: number
  playerLinkSuggestionsCreated: number
  batchErrors: number
}

const CHUNK = 200
const PAGE = 5000

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

export async function runCoachLinker(deps: CoachLinkerDeps): Promise<CoachLinkerResult> {
  const { supabase, logger, dryRun } = deps
  const log = logger.child({ worker: 'coach-linker' })

  const players = await paginatedSelect<{ id: string; name: string; coaches: string[] | null }>(
    (s, e) => supabase.from('players').select('id, name, coaches').order('id').range(s, e),
    { what: 'players (coach-linker)', pageSize: PAGE },
  )
  const coaches = await paginatedSelect<PlannerCoach & { player_id: string | null }>(
    (s, e) => supabase.from('coaches').select('id, normalized_name, display_name, slug, status, merged_into, player_id').order('id').range(s, e),
    { what: 'coaches', pageSize: PAGE },
  )
  const aliases = await paginatedSelect<{ normalized_alias: string; coach_id: string }>(
    (s, e) => supabase.from('coach_aliases').select('normalized_alias, coach_id').order('normalized_alias').range(s, e),
    { what: 'coach_aliases', pageSize: PAGE },
  )
  const existingLinks = await paginatedSelect<PlayerCoachLink>(
    (s, e) => supabase.from('player_coaches').select('player_id, coach_id, raw_name, position').order('player_id').order('coach_id').range(s, e),
    { what: 'player_coaches', pageSize: PAGE },
  )
  const mergeRows = await paginatedSelect<{ coach_a: string; coach_b: string }>(
    (s, e) => supabase.from('coach_merge_suggestions').select('coach_a, coach_b').order('id').range(s, e),
    { what: 'coach_merge_suggestions', pageSize: PAGE },
  )
  const linkRows = await paginatedSelect<{ coach_id: string; player_id: string }>(
    (s, e) => supabase.from('coach_player_link_suggestions').select('coach_id, player_id').order('coach_id').order('player_id').range(s, e),
    { what: 'coach_player_link_suggestions', pageSize: PAGE },
  )

  const linkedPlayerIds = new Set(existingLinks.map((l) => l.player_id))
  const plannerPlayers = players
    .filter((p) => (p.coaches?.length ?? 0) > 0 || linkedPlayerIds.has(p.id))
    .map((p) => ({ id: p.id, coaches: p.coaches ?? [] }))

  const plan = planCoachLinks({ players: plannerPlayers, coaches, aliases, existingLinks }, randomUUID)

  // Suggestions run over the post-plan coach set. On the first run every pair is
  // compared (~370k for ~860 coaches); afterwards only pairs touching new coaches.
  const allCoaches: SuggestionCoach[] = [
    ...coaches.map((c) => ({ id: c.id, normalized_name: c.normalized_name, status: c.status, player_id: c.player_id })),
    ...plan.newCoaches.map((c) => ({ id: c.id, normalized_name: c.normalized_name, status: 'unreviewed' as const, player_id: null })),
  ]
  const firstRun = coaches.length === 0
  const mergeSuggestions = generateMergeSuggestions(
    allCoaches,
    new Set(mergeRows.map((r) => pairKey(r.coach_a, r.coach_b))),
    firstRun ? undefined : new Set(plan.newCoaches.map((c) => c.id)),
  )
  const linkSuggestions = generatePlayerLinkSuggestions(
    allCoaches,
    players.map((p) => ({ id: p.id, normalized_name: normalizeCoachName(p.name ?? '') })),
    new Set(linkRows.map((r) => `${r.coach_id}|${r.player_id}`)),
    new Set(coaches.map((c) => c.player_id).filter((x): x is string => !!x)),
  )

  const result: CoachLinkerResult = {
    dryRun,
    playersScanned: plannerPlayers.length,
    rawStrings: plan.counts.rawStrings,
    aliasHits: plan.counts.aliasHits,
    autoAliases: plan.newAliases.length,
    coachesCreated: plan.newCoaches.length,
    playerLinksWritten: plan.linksToUpsert.length,
    playerLinksDeleted: plan.linksToDelete.length,
    suggestionsCreated: mergeSuggestions.length,
    playerLinkSuggestionsCreated: linkSuggestions.length,
    batchErrors: 0,
  }

  if (dryRun) {
    log.info({ result, sampleMerges: mergeSuggestions.slice(0, 10), sampleLinks: linkSuggestions.slice(0, 10) }, 'coach-linker dry run')
    return result
  }

  const write = async (what: string, rows: unknown[], op: (chunk: any[]) => PromiseLike<{ error: { message: string } | null }>) => {
    for (const chunk of chunks(rows)) {
      const { error } = await op(chunk)
      if (error) {
        result.batchErrors++
        log.warn({ what, size: chunk.length, error: error.message }, 'coach-linker chunk failed')
      }
    }
  }

  // Order matters for FKs: coaches → aliases → links → suggestions.
  await write('coaches', plan.newCoaches, (c) => supabase.from('coaches').insert(c))
  await write('coach_aliases', plan.newAliases, (c) =>
    supabase.from('coach_aliases').upsert(c, { onConflict: 'normalized_alias', ignoreDuplicates: true }))
  await write('player_coaches upsert', plan.linksToUpsert, (c) =>
    supabase.from('player_coaches').upsert(c, { onConflict: 'player_id,coach_id' }))
  for (const l of plan.linksToDelete) {
    const { error } = await supabase.from('player_coaches').delete().eq('player_id', l.player_id).eq('coach_id', l.coach_id)
    if (error) {
      result.batchErrors++
      log.warn({ link: l, error: error.message }, 'coach-linker link delete failed')
    }
  }
  await write('coach_merge_suggestions', mergeSuggestions, (c) =>
    supabase.from('coach_merge_suggestions').upsert(c, { onConflict: 'coach_a,coach_b', ignoreDuplicates: true }))
  await write('coach_player_link_suggestions', linkSuggestions, (c) =>
    supabase.from('coach_player_link_suggestions').upsert(c, { onConflict: 'coach_id,player_id', ignoreDuplicates: true }))

  log.info({ result }, 'coach-linker done')
  return result
}
```

- [ ] **Step 2: Typecheck**

Run: `cd padelgod && npx tsc --noEmit`
Expected: no errors. If `paginatedSelect`'s option name differs from `pageSize`/`what`, read `padelgod/src/lib/db-paginate.ts:65` and adapt.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/workers/coach-linker.ts
git commit -m "feat(coaches): coach-linker worker"
```

---

### Task 6: Scheduler + env wiring (padelgod)

**Files:**
- Modify: `padelgod/src/lib/env.ts` (next to `ENABLE_PROJECTION_READY_NOTIFIER`, ~line 246)
- Modify: `padelgod/src/scheduler.ts` (flags interface ~line 60, `WorkerName` union ~line 237, `ALL_WORKERS`, `getWorkerRunner` switch ~line 454, `buildSchedule` before `return entries`)
- Modify: `padelgod/src/index.ts` (~line 190 flags object)
- Test: `padelgod/src/__tests__/scheduler.test.ts`

- [ ] **Step 1: Write the failing scheduler tests**

Append inside the `describe('buildSchedule', …)` block in `padelgod/src/__tests__/scheduler.test.ts`:

```ts
  it('schedules coach-linker hourly at :50 when enabled', () => {
    const sched = buildSchedule({ ...ALL_ENABLED, enableCoachLinker: true, coachLinkerDryRun: true } as any)
    const entry = sched.find((s) => s.name === 'coach-linker')
    expect(entry).toBeDefined()
    expect(entry!.cron).toBe('50 * * * *')
  })

  it('omits coach-linker when flag is off', () => {
    const sched = buildSchedule({ ...ALL_ENABLED, enableCoachLinker: false } as any)
    expect(sched.map((s) => s.name)).not.toContain('coach-linker')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd padelgod && npx vitest run src/__tests__/scheduler.test.ts`
Expected: the first new test FAILS (`entry` undefined); the second passes trivially.

- [ ] **Step 3: Wire it**

`padelgod/src/lib/env.ts` — after `ENABLE_PROJECTION_READY_NOTIFIER: boolEnv(false),`:

```ts
  // coach-linker — maps players.coaches raw strings onto canonical coaches
  // (spec 2026-10-02-coach-normalization-design.md). Default OFF + dry-run ON:
  // enable, inspect the dry-run log, then set COACH_LINKER_DRY_RUN=false.
  ENABLE_COACH_LINKER: boolEnv(false),
  COACH_LINKER_DRY_RUN: boolEnv(true),
```

`padelgod/src/scheduler.ts`:

1. Import at the top with the other workers:
```ts
import { runCoachLinker } from './workers/coach-linker.js';
```
2. In the flags interface, after `enableProjectionReadyNotifier: boolean;`:
```ts
  /** coach-linker — hourly :50, after player-profile (:30). Default OFF. */
  enableCoachLinker: boolean;
  coachLinkerDryRun: boolean;
```
3. Add `| 'coach-linker'` to the `WorkerName` union and `'coach-linker',` to `ALL_WORKERS`.
4. In `getWorkerRunner`'s switch:
```ts
    case 'coach-linker': return (deps) => runCoachLinker({
      supabase: deps.supabase,
      logger: deps.logger,
      // Admin-trigger is always dry-run-safe; the cron threads the real flag.
      dryRun: true,
    });
```
5. In `buildSchedule`, before `return entries;`:
```ts
  if (flags.enableCoachLinker) {
    entries.push({
      name: 'coach-linker',
      // :50 — trails player-profile (:30) so fresh coach lists are linked the
      // same hour. DB-only; no HTTP.
      cron: '50 * * * *',
      run: async (d) => runCoachLinker({ supabase: d.supabase, logger: d.logger, dryRun: flags.coachLinkerDryRun }),
    });
  }
```

`padelgod/src/index.ts` — in the flags object after `enableProjectionReadyNotifier: env.ENABLE_PROJECTION_READY_NOTIFIER,`:
```ts
      enableCoachLinker: env.ENABLE_COACH_LINKER,
      coachLinkerDryRun: env.COACH_LINKER_DRY_RUN,
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd padelgod && npx vitest run src/__tests__/scheduler.test.ts src/__tests__/env.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. If `env.test.ts` snapshots the full env object, add the two new keys to its expectation.

- [ ] **Step 5: Full padelgod suite**

Run: `cd padelgod && npx vitest run`
Expected: all pass (same count as before + new tests).

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/lib/env.ts padelgod/src/scheduler.ts padelgod/src/index.ts padelgod/src/__tests__/scheduler.test.ts
git commit -m "feat(coaches): schedule coach-linker behind ENABLE_COACH_LINKER"
```

---

### Task 7: Admin shared types + patch validation (apps/ops, pure)

**Files:**
- Create: `apps/ops/src/lib/coaches.ts`
- Test: `apps/ops/src/lib/__tests__/coaches.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { validateCoachPatch, sortByImpact } from '../coaches'

describe('validateCoachPatch', () => {
  it('accepts allow-listed fields and trims strings', () => {
    expect(validateCoachPatch({ display_name: '  Gaby Reca ', status: 'verified', notes: '' })).toEqual({
      ok: true,
      update: { display_name: 'Gaby Reca', status: 'verified', notes: null },
    })
  })
  it('rejects status=merged (only merge_coaches may set it)', () => {
    expect(validateCoachPatch({ status: 'merged' })).toEqual({ ok: false, error: 'invalid status' })
  })
  it('rejects an empty display name', () => {
    expect(validateCoachPatch({ display_name: '   ' })).toEqual({ ok: false, error: 'display_name cannot be empty' })
  })
  it('accepts player_id uuid or null and rejects garbage', () => {
    expect(validateCoachPatch({ player_id: null })).toEqual({ ok: true, update: { player_id: null } })
    expect(validateCoachPatch({ player_id: '6f1c2b0e-8d1a-4c47-9a53-2f4f4b1b1c11' }).ok).toBe(true)
    expect(validateCoachPatch({ player_id: 'nope' })).toEqual({ ok: false, error: 'invalid player_id' })
  })
  it('ignores unknown fields and rejects an empty patch', () => {
    expect(validateCoachPatch({ slug: 'x', normalized_name: 'y' })).toEqual({ ok: false, error: 'nothing to update' })
  })
  it('uppercases a 2-letter country and rejects other lengths', () => {
    expect(validateCoachPatch({ country: 'es' })).toEqual({ ok: true, update: { country: 'ES' } })
    expect(validateCoachPatch({ country: 'ESP' })).toEqual({ ok: false, error: 'country must be ISO alpha-2' })
  })
})

describe('sortByImpact', () => {
  it('sorts by combined total points, descending', () => {
    const rows = [
      { id: 'a', a: { total_points: 10 }, b: { total_points: 5 } },
      { id: 'b', a: { total_points: 100 }, b: { total_points: 0 } },
    ]
    expect(sortByImpact(rows).map((r) => r.id)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/coaches.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// apps/ops/src/lib/coaches.ts
// Shared coach types + validation for the admin coach surfaces.
// Spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md

export type CoachStatus = 'unreviewed' | 'verified' | 'junk' | 'merged'
export const EDITABLE_STATUSES = ['unreviewed', 'verified', 'junk'] as const

export interface CoachStatsRow {
  coach_id: string
  display_name: string
  slug: string
  status: CoachStatus
  player_id: string | null
  player_count: number
  men_points: number
  women_points: number
  total_points: number
  variant_count: number
}

export interface CoachRow {
  id: string
  display_name: string
  normalized_name: string
  slug: string
  status: CoachStatus
  merged_into: string | null
  country: string | null
  avatar_url: string | null
  notes: string | null
  player_id: string | null
}

export interface CoachPatch {
  display_name?: string
  status?: (typeof EDITABLE_STATUSES)[number]
  country?: string | null
  avatar_url?: string | null
  notes?: string | null
  player_id?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const nullableText = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

export function validateCoachPatch(
  body: Record<string, unknown>,
): { ok: true; update: CoachPatch } | { ok: false; error: string } {
  const update: CoachPatch = {}
  if ('display_name' in body) {
    const name = typeof body.display_name === 'string' ? body.display_name.trim().replace(/\s+/g, ' ') : ''
    if (!name) return { ok: false, error: 'display_name cannot be empty' }
    update.display_name = name
  }
  if ('status' in body) {
    if (!EDITABLE_STATUSES.includes(body.status as never)) return { ok: false, error: 'invalid status' }
    update.status = body.status as CoachPatch['status']
  }
  if ('country' in body) {
    const c = nullableText(body.country)
    if (c !== null && !/^[a-z]{2}$/i.test(c)) return { ok: false, error: 'country must be ISO alpha-2' }
    update.country = c?.toUpperCase() ?? null
  }
  if ('avatar_url' in body) update.avatar_url = nullableText(body.avatar_url)
  if ('notes' in body) update.notes = nullableText(body.notes)
  if ('player_id' in body) {
    if (body.player_id !== null && !(typeof body.player_id === 'string' && UUID.test(body.player_id))) {
      return { ok: false, error: 'invalid player_id' }
    }
    update.player_id = body.player_id as string | null
  }
  if (Object.keys(update).length === 0) return { ok: false, error: 'nothing to update' }
  return { ok: true, update }
}

export function sortByImpact<T extends { a: { total_points: number }; b: { total_points: number } }>(rows: T[]): T[] {
  return [...rows].sort((x, y) => y.a.total_points + y.b.total_points - (x.a.total_points + x.b.total_points))
}

export const fmtPoints = (n: number) => Math.round(n).toLocaleString('en-US')
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/coaches.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/coaches.ts apps/ops/src/lib/__tests__/coaches.test.ts
git commit -m "feat(coaches): admin coach types + patch validation"
```

---

### Task 8: Admin API routes (apps/ops)

**Files:**
- Create: `apps/ops/src/app/api/internal/coaches/route.ts` (GET list + KPIs)
- Create: `apps/ops/src/app/api/internal/coaches/[id]/route.ts` (GET detail, PATCH)
- Create: `apps/ops/src/app/api/internal/coaches/merge/route.ts` (POST)
- Create: `apps/ops/src/app/api/internal/coaches/suggestions/route.ts` (GET queue)
- Create: `apps/ops/src/app/api/internal/coaches/suggestions/[id]/reject/route.ts` (POST)
- Create: `apps/ops/src/app/api/internal/coaches/player-links/route.ts` (POST link/reject)

All routes use the existing pattern: `auth()` → `session?.user?.isOperator` else 401; `serviceClient()` from `@/lib/supabase`.

- [ ] **Step 1: List route**

```ts
// apps/ops/src/app/api/internal/coaches/route.ts
// GET coach list from the coach_stats view + KPI counts.
//   ?q=<name> ?status=unreviewed|verified|junk|all (default: all except junk) ?page=1
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const PER_PAGE = 50

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const status = url.searchParams.get('status') ?? 'active'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const from = (page - 1) * PER_PAGE

  const supabase = serviceClient()
  let query = supabase.from('coach_stats').select('*', { count: 'exact' })
  if (q) query = query.ilike('display_name', `%${q}%`)
  if (status === 'active') query = query.neq('status', 'junk')
  else if (status !== 'all') query = query.eq('status', status)

  const { data, error, count } = await query
    .order('total_points', { ascending: false })
    .order('display_name')
    .range(from, from + PER_PAGE - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const head = { count: 'exact' as const, head: true }
  const [all, unreviewed, junk, pendingMerges, pendingLinks] = await Promise.all([
    supabase.from('coaches').select('id', head).neq('status', 'merged'),
    supabase.from('coaches').select('id', head).eq('status', 'unreviewed'),
    supabase.from('coaches').select('id', head).eq('status', 'junk'),
    supabase.from('coach_merge_suggestions').select('id', head).eq('status', 'pending'),
    supabase.from('coach_player_link_suggestions').select('coach_id', head).eq('status', 'pending'),
  ])

  return NextResponse.json({
    coaches: data ?? [],
    total: count ?? 0,
    page,
    per_page: PER_PAGE,
    kpis: {
      total: all.count ?? 0,
      unreviewed: unreviewed.count ?? 0,
      junk: junk.count ?? 0,
      pending: (pendingMerges.count ?? 0) + (pendingLinks.count ?? 0),
    },
  })
}
```

- [ ] **Step 2: Detail route**

```ts
// apps/ops/src/app/api/internal/coaches/[id]/route.ts
// GET: coach + aliases + players coached + linked player + pending suggestions.
// PATCH: allow-listed edits (validateCoachPatch). status='merged' only via merge route.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { validateCoachPatch } from '@/lib/coaches'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const supabase = serviceClient()

  const { data: coach, error } = await supabase.from('coaches').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!coach) return NextResponse.json({ error: 'Coach not found' }, { status: 404 })

  const [aliases, players, stats, merges, links, linkedPlayer] = await Promise.all([
    supabase.from('coach_aliases').select('normalized_alias, example_raw, source').eq('coach_id', id).order('normalized_alias'),
    supabase
      .from('player_coaches')
      .select('raw_name, position, player:players(id, name, display_name, category, ranking, points, tier, country)')
      .eq('coach_id', id),
    supabase.from('coach_stats').select('*').eq('coach_id', id).maybeSingle(),
    supabase
      .from('coach_merge_suggestions')
      .select('id, score, reason, a:coaches!coach_merge_suggestions_coach_a_fkey(id, display_name), b:coaches!coach_merge_suggestions_coach_b_fkey(id, display_name)')
      .eq('status', 'pending')
      .or(`coach_a.eq.${id},coach_b.eq.${id}`),
    supabase
      .from('coach_player_link_suggestions')
      .select('player:players(id, name, country, tier, ranking)')
      .eq('coach_id', id)
      .eq('status', 'pending'),
    coach.player_id
      ? supabase.from('players').select('id, name, display_name, country, ranking, tier').eq('id', coach.player_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  return NextResponse.json({
    coach,
    stats: stats.data,
    aliases: aliases.data ?? [],
    players: players.data ?? [],
    mergeSuggestions: merges.data ?? [],
    linkSuggestions: links.data ?? [],
    linkedPlayer: linkedPlayer.data,
  })
}

export async function PATCH(request: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const v = validateCoachPatch(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('coaches')
    .update({ ...v.update, updated_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'merged')
    .select('*')
    .maybeSingle()
  if (error) {
    // 23505 = unique violation on coaches_player_id_unique
    const status = error.code === '23505' ? 409 : 500
    const message = error.code === '23505' ? 'that player is already linked to another coach' : error.message
    return NextResponse.json({ error: message }, { status })
  }
  if (!data) return NextResponse.json({ error: 'Coach not found or already merged' }, { status: 404 })

  // Linking a player resolves any pending link suggestions for this coach.
  if ('player_id' in v.update && v.update.player_id) {
    await supabase
      .from('coach_player_link_suggestions')
      .update({ status: 'rejected', decided_at: new Date().toISOString() })
      .eq('coach_id', id)
      .eq('status', 'pending')
      .neq('player_id', v.update.player_id)
    await supabase
      .from('coach_player_link_suggestions')
      .update({ status: 'linked', decided_at: new Date().toISOString() })
      .eq('coach_id', id)
      .eq('player_id', v.update.player_id)
  }
  return NextResponse.json({ coach: data })
}
```

- [ ] **Step 3: Merge route**

```ts
// apps/ops/src/app/api/internal/coaches/merge/route.ts
// POST { sourceId, targetId, keepSourceName? } → merge_coaches() (atomic, in Postgres).
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: { sourceId?: string; targetId?: string; keepSourceName?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.sourceId || !body.targetId) {
    return NextResponse.json({ error: 'missing required fields: sourceId, targetId' }, { status: 400 })
  }
  const { error } = await serviceClient().rpc('merge_coaches', {
    p_source: body.sourceId,
    p_target: body.targetId,
    p_keep_source_name: body.keepSourceName === true,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, targetId: body.targetId })
}
```

- [ ] **Step 4: Suggestions queue route**

```ts
// apps/ops/src/app/api/internal/coaches/suggestions/route.ts
// GET pending merge suggestions (sorted by combined points) + pending player-link suggestions.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { sortByImpact, type CoachStatsRow } from '@/lib/coaches'

const LIMIT = 100

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()

  const { data: merges, error } = await supabase
    .from('coach_merge_suggestions')
    .select('id, coach_a, coach_b, score, reason')
    .eq('status', 'pending')
    .limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = [...new Set((merges ?? []).flatMap((m) => [m.coach_a, m.coach_b]))]
  const stats = new Map<string, CoachStatsRow>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('coach_stats').select('*').in('coach_id', ids.slice(i, i + 200))
    for (const s of (data ?? []) as CoachStatsRow[]) stats.set(s.coach_id, s)
  }
  const aliasRows: { coach_id: string; example_raw: string }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('coach_aliases').select('coach_id, example_raw').in('coach_id', ids.slice(i, i + 200))
    aliasRows.push(...(data ?? []))
  }
  const variants = new Map<string, string[]>()
  for (const a of aliasRows) variants.set(a.coach_id, [...(variants.get(a.coach_id) ?? []), a.example_raw])

  const side = (id: string) => ({
    ...(stats.get(id) ?? { coach_id: id, display_name: '?', total_points: 0, player_count: 0 }),
    variants: variants.get(id) ?? [],
  })
  const mergeRows = sortByImpact(
    (merges ?? [])
      .filter((m) => stats.has(m.coach_a) && stats.has(m.coach_b))
      .map((m) => ({ id: m.id, score: Number(m.score), reason: m.reason, a: side(m.coach_a), b: side(m.coach_b) })),
  ).slice(0, LIMIT)

  const { data: links } = await supabase
    .from('coach_player_link_suggestions')
    .select('coach_id, player_id, coach:coaches(id, display_name), player:players(id, name, country, tier, ranking, category)')
    .eq('status', 'pending')
    .limit(LIMIT)

  return NextResponse.json({ merges: mergeRows, mergeTotal: merges?.length ?? 0, links: links ?? [] })
}
```

- [ ] **Step 5: Reject + player-link routes**

```ts
// apps/ops/src/app/api/internal/coaches/suggestions/[id]/reject/route.ts
// POST → mark a merge suggestion "not the same person". Permanent: never re-suggested.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await serviceClient()
    .from('coach_merge_suggestions')
    .update({ status: 'rejected', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

```ts
// apps/ops/src/app/api/internal/coaches/player-links/route.ts
// POST { coachId, playerId, decision: 'link' | 'reject' }
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: { coachId?: string; playerId?: string; decision?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const { coachId, playerId, decision } = body
  if (!coachId || !playerId || (decision !== 'link' && decision !== 'reject')) {
    return NextResponse.json({ error: 'need coachId, playerId, decision=link|reject' }, { status: 400 })
  }
  const supabase = serviceClient()
  const now = new Date().toISOString()

  if (decision === 'link') {
    const { error } = await supabase.from('coaches').update({ player_id: playerId, updated_at: now }).eq('id', coachId)
    if (error) {
      const status = error.code === '23505' ? 409 : 500
      return NextResponse.json({ error: error.code === '23505' ? 'that player is already linked to another coach' : error.message }, { status })
    }
    await supabase.from('coach_player_link_suggestions').update({ status: 'rejected', decided_at: now })
      .eq('coach_id', coachId).eq('status', 'pending').neq('player_id', playerId)
  }
  const { error } = await supabase
    .from('coach_player_link_suggestions')
    .update({ status: decision === 'link' ? 'linked' : 'rejected', decided_at: now })
    .eq('coach_id', coachId)
    .eq('player_id', playerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no new errors in `src/app/api/internal/coaches/**`. (The embed hint names `coach_merge_suggestions_coach_a_fkey` are Postgres' default FK names; they're resolved at runtime and verified in Task 14.)

- [ ] **Step 7: Commit**

```bash
git add apps/ops/src/app/api/internal/coaches
git commit -m "feat(coaches): admin coach API routes"
```

---

### Task 9: Players tab view switch + Coaches view (apps/ops)

**Files:**
- Create: `apps/ops/src/app/(app)/players/_components/PlayersViews.tsx`
- Create: `apps/ops/src/app/(app)/players/_components/CoachesView.tsx`
- Modify: `apps/ops/src/app/(app)/players/page.tsx`

- [ ] **Step 1: View switch**

```tsx
'use client'
// apps/ops/src/app/(app)/players/_components/PlayersViews.tsx
// Players · Coaches · Review queue. Coaches live inside the Players tab
// (decided 2026-10-02) so a player-turned-coach is one click away.
// The view is in the URL (?view=coaches) so it's linkable.

import React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Pill } from '@/components/ui'
import PlayersTab from './PlayersTab'
import CoachesView from './CoachesView'
import CoachReviewQueue from './CoachReviewQueue'

const VIEWS = [
  { key: 'players', label: 'Players' },
  { key: 'coaches', label: 'Coaches' },
  { key: 'review', label: 'Review queue' },
] as const
type View = (typeof VIEWS)[number]['key']

const chipBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer' }

export default function PlayersViews() {
  const params = useSearchParams()
  const router = useRouter()
  const raw = params.get('view')
  const view: View = raw === 'coaches' || raw === 'review' ? raw : 'players'

  const setView = (v: View) => {
    const next = new URLSearchParams(params.toString())
    if (v === 'players') next.delete('view')
    else next.set('view', v)
    const qs = next.toString()
    router.replace(qs ? `/players?${qs}` : '/players')
  }

  return (
    <>
      <div className="ui-page" style={{ paddingBottom: 0, display: 'flex', gap: 8 }}>
        {VIEWS.map((v) => (
          <button key={v.key} type="button" style={chipBtn} onClick={() => setView(v.key)} aria-pressed={view === v.key}>
            <Pill tone={view === v.key ? 'lime' : 'neutral'}>{v.label}</Pill>
          </button>
        ))}
      </div>
      {view === 'players' && <PlayersTab />}
      {view === 'coaches' && <CoachesView />}
      {view === 'review' && <CoachReviewQueue />}
    </>
  )
}
```

- [ ] **Step 2: Coaches view**

```tsx
'use client'
// apps/ops/src/app/(app)/players/_components/CoachesView.tsx
// Coach list sorted by summed pro points of the players they coach — the
// internal coach ranking. Men/women points shown separately (different scales).

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Panel, KpiStrip, Kpi, DataTable, Pill, Button, EmptyState, Skeleton } from '@/components/ui'
import { fmtPoints, type CoachStatsRow } from '@/lib/coaches'

const STATUS_FILTERS = [
  { key: 'active', label: 'All (no junk)' },
  { key: 'unreviewed', label: 'Unreviewed' },
  { key: 'verified', label: 'Verified' },
  { key: 'junk', label: 'Junk' },
] as const

const STATUS_TONE: Record<string, 'lime' | 'warn' | 'neutral'> = { verified: 'lime', unreviewed: 'warn', junk: 'neutral' }
const chipBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer' }

interface ListResponse {
  coaches: CoachStatsRow[]
  total: number
  page: number
  per_page: number
  kpis: { total: number; unreviewed: number; junk: number; pending: number }
}

export default function CoachesView() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('active')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      const params = new URLSearchParams({ status, page: String(page) })
      if (q.trim()) params.set('q', q.trim())
      fetch(`/api/internal/coaches?${params}`)
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
        .then((d: ListResponse) => { setData(d); setError(null) })
        .catch((e: Error) => setError(e.message))
    }, 250)
  }, [q, status, page])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1

  return (
    <div className="ui-page">
      <PageHeader title="Coaches" subtitle="Canonical coaches built from FIP profile coach names. Sorted by summed pro points of coached players." />
      {data && (
        <KpiStrip cols={4}>
          <Kpi label="Coaches" value={data.kpis.total} />
          <Kpi label="Unreviewed" value={data.kpis.unreviewed} tone="warn" />
          <Kpi label="Pending suggestions" value={data.kpis.pending} tone={data.kpis.pending ? 'urgent' : 'neutral'} />
          <Kpi label="Junk" value={data.kpis.junk} tone="neutral" />
        </KpiStrip>
      )}
      <Panel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input
            className="ui-input"
            placeholder="Search coach…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
            style={{ minWidth: 220 }}
          />
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} type="button" style={chipBtn} onClick={() => { setStatus(f.key); setPage(1) }}>
              <Pill tone={status === f.key ? 'lime' : 'neutral'}>{f.label}</Pill>
            </button>
          ))}
        </div>
        {error && <EmptyState title="Failed to load coaches" hint={error} />}
        {!data && !error && <Skeleton rows={8} />}
        {data && data.coaches.length === 0 && <EmptyState title="No coaches" hint="Has the coach-linker run yet?" />}
        {data && data.coaches.length > 0 && (
          <DataTable>
            <thead>
              <tr>
                <th>#</th><th>Coach</th><th>Status</th><th>Variants</th><th>Players</th><th>Men pts</th><th>Women pts</th>
              </tr>
            </thead>
            <tbody>
              {data.coaches.map((c, i) => (
                <tr key={c.coach_id}>
                  <td style={{ color: 'var(--text-3)' }}>{(page - 1) * data.per_page + i + 1}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <Link href={`/players/coaches/${c.coach_id}`} style={{ color: 'var(--text-1)', fontWeight: 500 }}>
                        {c.display_name}
                      </Link>
                      {c.player_id && (
                        <Link href={`/players/${c.player_id}`} title="Also a player">
                          <Pill tone="men">Player</Pill>
                        </Link>
                      )}
                    </span>
                  </td>
                  <td><Pill tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Pill></td>
                  <td>{c.variant_count}</td>
                  <td>{c.player_count}</td>
                  <td>{fmtPoints(c.men_points)}</td>
                  <td>{fmtPoints(c.women_points)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        {data && pages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, alignItems: 'center' }}>
            <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{page} / {pages}</span>
            <Button size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next</Button>
          </div>
        )}
      </Panel>
    </div>
  )
}
```

If `ui-input` isn't a class in `apps/ops/src/app/ui.css`, use the same input styling PlayersTab uses for its search box (copy its `style`/`className`). Check: `grep -n "input" apps/ops/src/app/ui.css`. If `Button` doesn't accept `onClick`, check `apps/ops/src/components/ui/Pill.tsx:24` — it spreads the rest props in the existing code; adapt if not.

- [ ] **Step 3: Page uses the switch**

Replace the body of `apps/ops/src/app/(app)/players/page.tsx`:

```tsx
import { Suspense } from 'react'
import PlayersViews from './_components/PlayersViews'

export const metadata = { title: 'Players · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function PlayersPage() {
  return (
    <Suspense>
      <PlayersViews />
    </Suspense>
  )
}
```

(`useSearchParams` in a client component needs a Suspense boundary in Next 16 — check `node_modules/next/dist/docs/` for "useSearchParams" if the build warns.)

- [ ] **Step 4: Typecheck** (CoachReviewQueue doesn't exist yet — create a placeholder file first so the import resolves, it is replaced in Task 10):

```tsx
'use client'
// Replaced in Task 10.
export default function CoachReviewQueue() { return null }
```

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/players"
git commit -m "feat(coaches): Players · Coaches view switch + coach list"
```

---

### Task 10: Review queue (apps/ops)

**Files:**
- Modify (replace placeholder): `apps/ops/src/app/(app)/players/_components/CoachReviewQueue.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client'
// apps/ops/src/app/(app)/players/_components/CoachReviewQueue.tsx
// Fuzzy coach matches are never applied automatically — they land here.
//  - Merge suggestions: high-impact first (combined points). Merge or "Not the same person".
//  - Player-link suggestions: coach name == player name. Link or "Not the same person".
// "Not the same person" is permanent (Juan Gutiérrez ≠ Juanjo Gutiérrez, 2026-09-18).

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Panel, Pill, Button, EmptyState, Skeleton } from '@/components/ui'
import { fmtPoints } from '@/lib/coaches'

interface Side { coach_id: string; display_name: string; total_points: number; player_count: number; variants: string[] }
interface MergeRow { id: string; score: number; reason: string; a: Side; b: Side }
interface LinkRow {
  coach_id: string
  player_id: string
  coach: { id: string; display_name: string } | null
  player: { id: string; name: string; country: string | null; tier: string | null; ranking: number | null; category: string | null } | null
}
interface QueueResponse { merges: MergeRow[]; mergeTotal: number; links: LinkRow[] }

async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
}

function CoachSide({ s }: { s: Side }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Link href={`/players/coaches/${s.coach_id}`} style={{ fontWeight: 600, color: 'var(--text-1)' }}>{s.display_name}</Link>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {fmtPoints(s.total_points)} pts · {s.player_count} players
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{s.variants.join(' / ')}</div>
    </div>
  )
}

export default function CoachReviewQueue() {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/internal/coaches/suggestions')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
      .then((d: QueueResponse) => { setData(d); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn(); load() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  // Default survivor = the side with more points; operator can flip it.
  const merge = (m: MergeRow, keep: 'a' | 'b') => {
    const target = keep === 'a' ? m.a : m.b
    const source = keep === 'a' ? m.b : m.a
    return act(m.id, () => post('/api/internal/coaches/merge', { sourceId: source.coach_id, targetId: target.coach_id }))
  }

  return (
    <div className="ui-page">
      <PageHeader title="Coach review queue" subtitle="Fuzzy matches are never merged automatically. Decide them here." />
      {error && <EmptyState title="Something failed" hint={error} />}
      {!data && !error && <Skeleton rows={6} />}
      {data && (
        <>
          <Panel title={`Merge suggestions (${data.mergeTotal})`}>
            {data.merges.length === 0 && <EmptyState title="Nothing to review" />}
            {data.merges.map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-card)' }}>
                <CoachSide s={m.a} />
                <Pill tone="neutral">{m.reason} {m.score}</Pill>
                <CoachSide s={m.b} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="primary" disabled={busy === m.id} onClick={() => merge(m, m.a.total_points >= m.b.total_points ? 'a' : 'b')}>
                    Merge → {(m.a.total_points >= m.b.total_points ? m.a : m.b).display_name}
                  </Button>
                  <Button size="sm" disabled={busy === m.id} onClick={() => merge(m, m.a.total_points >= m.b.total_points ? 'b' : 'a')}>
                    Merge → {(m.a.total_points >= m.b.total_points ? m.b : m.a).display_name}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === m.id} onClick={() => act(m.id, () => post(`/api/internal/coaches/suggestions/${m.id}/reject`))}>
                    Not the same person
                  </Button>
                </div>
              </div>
            ))}
          </Panel>
          <Panel title={`Coach ↔ player (${data.links.length})`}>
            {data.links.length === 0 && <EmptyState title="No player-link suggestions" />}
            {data.links.map((l) => {
              const key = `${l.coach_id}|${l.player_id}`
              return (
                <div key={key} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-card)' }}>
                  <div style={{ flex: 1 }}>
                    Coach <Link href={`/players/coaches/${l.coach_id}`} style={{ fontWeight: 600 }}>{l.coach?.display_name}</Link>
                    {' '}might be player{' '}
                    <Link href={`/players/${l.player_id}`} style={{ fontWeight: 600 }}>{l.player?.name}</Link>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {' '}· {l.player?.country ?? '—'} · {l.player?.tier ?? 'pro'} · {l.player?.ranking ? `#${l.player.ranking}` : 'unranked'}
                    </span>
                  </div>
                  <Button size="sm" variant="primary" disabled={busy === key}
                    onClick={() => act(key, () => post('/api/internal/coaches/player-links', { coachId: l.coach_id, playerId: l.player_id, decision: 'link' }))}>
                    Link
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === key}
                    onClick={() => act(key, () => post('/api/internal/coaches/player-links', { coachId: l.coach_id, playerId: l.player_id, decision: 'reject' }))}>
                    Not the same person
                  </Button>
                </div>
              )
            })}
          </Panel>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no new errors. If `Button` lacks `disabled`, it forwards native button props (check `Pill.tsx:24-40`); adapt to its actual props.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/players/_components/CoachReviewQueue.tsx"
git commit -m "feat(coaches): review queue for merge + player-link suggestions"
```

---

### Task 11: Coach detail page (apps/ops)

**Files:**
- Create: `apps/ops/src/app/(app)/players/coaches/[id]/page.tsx`
- Create: `apps/ops/src/app/(app)/players/coaches/[id]/_components/CoachProfile.tsx`

`PlayerPicker` already exists at `apps/ops/src/app/(app)/players/_components/PlayerPicker.tsx` — read its props first (`grep -n "interface\|export default" …/PlayerPicker.tsx`) and use it for the "Is player…" picker. For "Merge into…", a simple search input calling `/api/internal/coaches?q=` is enough.

- [ ] **Step 1: Page**

```tsx
// apps/ops/src/app/(app)/players/coaches/[id]/page.tsx
import CoachProfile from './_components/CoachProfile'

export const metadata = { title: 'Coach · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CoachProfile coachId={id} />
}
```

- [ ] **Step 2: Profile component**

```tsx
'use client'
// apps/ops/src/app/(app)/players/coaches/[id]/_components/CoachProfile.tsx
// Coach detail — mirrors the player detail layout. Edits go through
// PATCH /api/internal/coaches/[id]; merges through POST /api/internal/coaches/merge.

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PageHeader, Panel, Pill, Button, DataTable, Field, EmptyState, Skeleton } from '@/components/ui'
import { EDITABLE_STATUSES, fmtPoints, type CoachRow, type CoachStatsRow } from '@/lib/coaches'
import PlayerPicker from '../../../_components/PlayerPicker'

interface Detail {
  coach: CoachRow
  stats: CoachStatsRow | null
  aliases: { normalized_alias: string; example_raw: string; source: string }[]
  players: { raw_name: string; player: { id: string; name: string; display_name: string | null; category: string | null; ranking: number | null; points: number | null; tier: string | null } | null }[]
  mergeSuggestions: { id: string; score: number; reason: string; a: { id: string; display_name: string }; b: { id: string; display_name: string } }[]
  linkSuggestions: { player: { id: string; name: string; country: string | null; tier: string | null; ranking: number | null } | null }[]
  linkedPlayer: { id: string; name: string; display_name: string | null } | null
}

export default function CoachProfile({ coachId }: { coachId: string }) {
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mergeQ, setMergeQ] = useState('')
  const [mergeHits, setMergeHits] = useState<CoachStatsRow[]>([])

  const load = useCallback(() => {
    fetch(`/api/internal/coaches/${coachId}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
      .then((x: Detail) => { setD(x); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [coachId])
  useEffect(load, [load])

  useEffect(() => {
    if (mergeQ.trim().length < 2) { setMergeHits([]); return }
    const t = setTimeout(() => {
      fetch(`/api/internal/coaches?status=all&q=${encodeURIComponent(mergeQ.trim())}`)
        .then((r) => r.json())
        .then((x) => setMergeHits(((x.coaches ?? []) as CoachStatsRow[]).filter((c) => c.coach_id !== coachId).slice(0, 8)))
    }, 250)
    return () => clearTimeout(t)
  }, [mergeQ, coachId])

  const patch = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/internal/coaches/${coachId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) { setError((await r.json()).error ?? r.statusText); return }
    load()
  }

  const mergeInto = async (targetId: string, targetName: string) => {
    if (!confirm(`Merge "${d?.coach.display_name}" into "${targetName}"? Aliases and players move to ${targetName}.`)) return
    const r = await fetch('/api/internal/coaches/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: coachId, targetId }),
    })
    if (!r.ok) { setError((await r.json()).error ?? r.statusText); return }
    router.push(`/players/coaches/${targetId}`)
  }

  if (error && !d) return <div className="ui-page"><EmptyState title="Failed to load coach" hint={error} /></div>
  if (!d) return <div className="ui-page"><Skeleton rows={8} /></div>
  const c = d.coach

  if (c.status === 'merged' && c.merged_into) {
    return (
      <div className="ui-page">
        <EmptyState title="This coach was merged" hint={<Link href={`/players/coaches/${c.merged_into}`}>Open the surviving coach →</Link>} />
      </div>
    )
  }

  return (
    <div className="ui-page">
      <PageHeader
        title={c.display_name}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <Link href="/players?view=coaches">← Coaches</Link>
            <Pill tone={c.status === 'verified' ? 'lime' : c.status === 'junk' ? 'neutral' : 'warn'}>{c.status}</Pill>
            {d.linkedPlayer && (
              <Link href={`/players/${d.linkedPlayer.id}`}><Pill tone="men">Player: {d.linkedPlayer.display_name || d.linkedPlayer.name}</Pill></Link>
            )}
            {d.stats && <span>{fmtPoints(d.stats.men_points)} men pts · {fmtPoints(d.stats.women_points)} women pts · {d.stats.player_count} players</span>}
          </span>
        }
      />
      {error && <EmptyState title="Last action failed" hint={error} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title="Profile">
          <Field label="Display name">
            <input className="ui-input" defaultValue={c.display_name} onBlur={(e) => e.target.value.trim() !== c.display_name && patch({ display_name: e.target.value })} />
          </Field>
          <Field label="Status">
            <div style={{ display: 'flex', gap: 6 }}>
              {EDITABLE_STATUSES.map((s) => (
                <Button key={s} size="sm" variant={c.status === s ? 'primary' : 'default'} onClick={() => c.status !== s && patch({ status: s })}>{s}</Button>
              ))}
            </div>
          </Field>
          <Field label="Country (ISO-2)">
            <input className="ui-input" defaultValue={c.country ?? ''} onBlur={(e) => (e.target.value || null) !== c.country && patch({ country: e.target.value })} />
          </Field>
          <Field label="Avatar URL">
            <input className="ui-input" defaultValue={c.avatar_url ?? ''} onBlur={(e) => (e.target.value || null) !== c.avatar_url && patch({ avatar_url: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea className="ui-input" defaultValue={c.notes ?? ''} onBlur={(e) => (e.target.value || null) !== c.notes && patch({ notes: e.target.value })} />
          </Field>
        </Panel>

        <Panel title="Is also a player">
          {d.linkedPlayer ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Link href={`/players/${d.linkedPlayer.id}`}>{d.linkedPlayer.display_name || d.linkedPlayer.name}</Link>
              <Button size="sm" variant="ghost" onClick={() => patch({ player_id: null })}>Unlink</Button>
            </div>
          ) : (
            <PlayerPicker onSelect={(p: { id: string }) => patch({ player_id: p.id })} />
          )}
          {d.linkSuggestions.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
              Suggested: {d.linkSuggestions.map((s) => s.player?.name).filter(Boolean).join(', ')} — decide in the review queue.
            </div>
          )}
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title={`Aliases (${d.aliases.length})`}>
          <DataTable>
            <thead><tr><th>Raw spelling</th><th>Source</th></tr></thead>
            <tbody>
              {d.aliases.map((a) => (
                <tr key={a.normalized_alias}><td>{a.example_raw}</td><td><Pill tone="neutral">{a.source}</Pill></td></tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Merge into another coach">
          <input className="ui-input" placeholder="Search coach…" value={mergeQ} onChange={(e) => setMergeQ(e.target.value)} />
          {mergeHits.map((h) => (
            <div key={h.coach_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>{h.display_name} <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{fmtPoints(h.total_points)} pts</span></span>
              <Button size="sm" onClick={() => mergeInto(h.coach_id, h.display_name)}>Merge into</Button>
            </div>
          ))}
          {d.mergeSuggestions.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
              Pending suggestions: {d.mergeSuggestions.map((m) => (m.a.id === coachId ? m.b : m.a).display_name).join(', ')}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={`Players coached (${d.players.length})`}>
        {d.players.length === 0 && <EmptyState title="No players currently list this coach" />}
        {d.players.length > 0 && (
          <DataTable>
            <thead><tr><th>Player</th><th>Category</th><th>Rank</th><th>Points</th><th>As written on FIP</th></tr></thead>
            <tbody>
              {[...d.players]
                .sort((x, y) => (y.player?.points ?? 0) - (x.player?.points ?? 0))
                .map((row) => row.player && (
                  <tr key={row.player.id}>
                    <td><Link href={`/players/${row.player.id}`}>{row.player.display_name || row.player.name}</Link></td>
                    <td>{row.player.category ?? '—'}</td>
                    <td>{row.player.ranking ?? '—'}</td>
                    <td>{fmtPoints(row.player.points ?? 0)}</td>
                    <td style={{ color: 'var(--text-3)' }}>{row.raw_name}</td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </div>
  )
}
```

Adapt the `PlayerPicker` usage to its real props after reading the file (the prop may be `onPick`/`onChange`, with a different payload shape).

- [ ] **Step 3: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/players/coaches"
git commit -m "feat(coaches): coach detail page"
```

---

### Task 12: Coach tags on players (list + detail) + ⌘K

**Files:**
- Modify: `apps/ops/src/app/api/internal/search-players/route.ts:29` (select)
- Modify: `apps/ops/src/app/(app)/players/_components/types.ts` (`PlayerSummary`)
- Modify: `apps/ops/src/app/(app)/players/_components/PlayersTable.tsx:~234` (name cell)
- Modify: `apps/ops/src/app/api/internal/player/[id]/route.ts:~193` (response)
- Modify: `apps/ops/src/app/(app)/players/[id]/_components/CoachesSection.tsx`
- Modify: `apps/ops/src/app/(app)/players/[id]/_components/PlayerProfile.tsx:~37,~174`
- Modify: `apps/ops/src/lib/command-palette.ts:49`, `apps/ops/src/app/api/internal/search/route.ts`

- [ ] **Step 1: Player list carries the coach record**

In `search-players/route.ts`, change the select string to:

```ts
    .select('id, name, display_name, country, ranking, points, category, avatar_url, photo_url, fip_id, coach_record:coaches!coaches_player_id_fkey(id)', { count: 'exact' })
```

In `types.ts`, add to `PlayerSummary`:

```ts
  /** Set when this player is also a coach (coaches.player_id). PostgREST returns an array. */
  coach_record?: { id: string }[] | null
```

In `PlayersTable.tsx`, right after the `<span …>{player.display_name || player.name}</span>` element (inside the same inline-flex span), add:

```tsx
                        {player.coach_record?.[0] && (
                          <Link
                            href={`/players/coaches/${player.coach_record[0].id}`}
                            title="Also a coach"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Pill tone="lime">Coach</Pill>
                          </Link>
                        )}
```

Add `import { Pill } from '@/components/ui'` to `PlayersTable.tsx` if it isn't imported.

- [ ] **Step 2: Player detail carries links**

In `apps/ops/src/app/api/internal/player/[id]/route.ts`, before the final `return NextResponse.json({…})`:

```ts
  const [{ data: coachLinks }, { data: coachRecord }] = await Promise.all([
    supabase
      .from('player_coaches')
      .select('raw_name, position, coach:coaches(id, display_name, status)')
      .eq('player_id', id)
      .order('position'),
    supabase.from('coaches').select('id, display_name').eq('player_id', id).maybeSingle(),
  ])
```

and add `coachLinks: coachLinks ?? [], coachRecord: coachRecord ?? null,` to the returned object.

Replace `CoachesSection.tsx`:

```tsx
'use client'
// apps/ops/src/app/(app)/players/[id]/_components/CoachesSection.tsx
// Coaches OF this player. Linked coaches link to their coach record; raw
// strings not yet linked by coach-linker are shown as plain text. Editing the
// raw list happens in ProfileSection above (next linker run picks it up).

import Link from 'next/link'
import { Panel, Pill } from '@/components/ui'

export interface CoachLink {
  raw_name: string
  position: number
  coach: { id: string; display_name: string; status: string } | null
}

export default function CoachesSection({ coaches, links }: { coaches: string[] | null; links: CoachLink[] }) {
  const raw = coaches ?? []
  if (raw.length === 0 && links.length === 0) {
    return (
      <Panel title="Coaches">
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          No coaches recorded. Edit in the Profile section above.
        </div>
      </Panel>
    )
  }
  const linkedRaw = new Set(links.map((l) => l.raw_name))
  return (
    <Panel title="Coaches">
      <ul className="list-disc list-inside text-xs space-y-0.5" style={{ color: 'var(--text-2)' }}>
        {links.map((l) => l.coach && (
          <li key={l.coach.id}>
            <Link href={`/players/coaches/${l.coach.id}`}>{l.coach.display_name}</Link>
            {l.coach.display_name !== l.raw_name && <span style={{ color: 'var(--text-4)' }}> (FIP: {l.raw_name})</span>}
            {l.coach.status === 'junk' && <> <Pill tone="neutral">junk</Pill></>}
          </li>
        ))}
        {raw.filter((r) => !linkedRaw.has(r)).map((r) => (
          <li key={r}>{r} <span style={{ color: 'var(--text-4)' }}>(not linked yet)</span></li>
        ))}
      </ul>
    </Panel>
  )
}
```

In `PlayerProfile.tsx`:
- Add to `AggregatorResponse`: `coachLinks: import('./CoachesSection').CoachLink[]` and `coachRecord: { id: string; display_name: string } | null`.
- Change line ~174 to `<CoachesSection coaches={state.data.player.coaches} links={state.data.coachLinks ?? []} />`.
- Next to `<ProfileHeader player={state.data.player} />` (line ~110), render the tag:

```tsx
            {state.data.coachRecord && (
              <Link href={`/players/coaches/${state.data.coachRecord.id}`} title="Also a coach">
                <Pill tone="lime">Coach</Pill>
              </Link>
            )}
```
(add `Pill` to the `@/components/ui` import).

- [ ] **Step 3: ⌘K coach hits**

`apps/ops/src/lib/command-palette.ts:49` — widen the union:

```ts
export interface EntityHit { kind: 'player' | 'tournament' | 'match' | 'coach'; id: string; label: string; sub?: string; href: string }
```

`apps/ops/src/app/api/internal/search/route.ts` — after the loop over `ops_global_search` rows, inside the same `try`:

```ts
    const { data: coachRows } = await supabase
      .from('coach_stats')
      .select('coach_id, display_name, player_count')
      .ilike('display_name', `%${q}%`)
      .neq('status', 'junk')
      .order('total_points', { ascending: false })
      .limit(5)
    for (const c of coachRows ?? []) {
      hits.push({
        kind: 'coach',
        id: c.coach_id,
        label: c.display_name,
        sub: `Coach · ${c.player_count} players`,
        href: `/players/coaches/${c.coach_id}`,
      })
    }
```

Then grep for exhaustive switches on `kind`: `grep -rn "hit.kind\|\.kind ===" apps/ops/src/components/shell apps/ops/src/lib/command-palette.ts` and add a `coach` branch wherever a per-kind icon/label map exists.

- [ ] **Step 4: Typecheck + ops tests**

Run: `cd apps/ops && npx tsc --noEmit && npx vitest run`
Expected: no new type errors; tests pass. `api/internal/player/[id]/__tests__/aggregator.test.ts` may assert the exact response keys — if it fails only because of the two new keys, add them to its expectation.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src
git commit -m "feat(coaches): Coach tag on players, coach links on player detail, ⌘K coaches"
```

---

### Task 13: Seed-decisions script

**Files:**
- Create: `scripts/seed-coach-decisions.ts`

Records the decisions agreed on 2026-09-18. Dry-run by default; `--apply` writes. **Running with `--apply` is a prod write: only on Gustavo's go-ahead (Task 14).**

- [ ] **Step 1: Implement**

```ts
// Records coach decisions agreed with Gustavo on 2026-09-18 (memory: coach-name-dedup-rules).
//   npx tsx scripts/seed-coach-decisions.ts          # dry run: prints what it would do
//   npx tsx scripts/seed-coach-decisions.ts --apply  # writes (prod — needs go-ahead)
// Run AFTER the first non-dry coach-linker run (coaches must exist).
import { Client } from 'pg'

const MERGES: [source: string, target: string][] = [
  ['agustin silingo', 'agustin gomez silingo'],
  ['sebastian luis nerone', 'sebastian nerone'],
  ['jorge benito', 'jorge de benito'],
]
const REJECTS: [string, string][] = [
  ['juan gutierrez', 'juan jose gutierrez'],
  ['juan gutierrez', 'juan jose gutierrez vicario'],
  ['juan carlos rodriguez', 'juan manuel rodriguez'],
]

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const find = async (alias: string): Promise<{ id: string; display_name: string } | null> => {
    const r = await c.query(
      `select co.id, co.display_name from coach_aliases a join coaches co on co.id = a.coach_id
       where a.normalized_alias = $1 and co.status <> 'merged'`, [alias])
    return r.rows[0] ?? null
  }
  try {
    for (const [s, t] of MERGES) {
      const [src, tgt] = [await find(s), await find(t)]
      if (!src || !tgt) { console.log(`SKIP merge ${s} → ${t}: not found (${!!src}, ${!!tgt})`); continue }
      if (src.id === tgt.id) { console.log(`SKIP merge ${s} → ${t}: already the same coach`); continue }
      console.log(`${apply ? 'MERGE' : 'would merge'} ${src.display_name} → ${tgt.display_name}`)
      if (apply) await c.query('select merge_coaches($1, $2, false)', [src.id, tgt.id])
    }
    for (const [x, y] of REJECTS) {
      const [a, b] = [await find(x), await find(y)]
      if (!a || !b) { console.log(`SKIP reject ${x} ↔ ${y}: not found (${!!a}, ${!!b})`); continue }
      console.log(`${apply ? 'REJECT' : 'would reject'} ${a.display_name} ↔ ${b.display_name}`)
      if (apply) {
        await c.query(
          `insert into coach_merge_suggestions (coach_a, coach_b, score, reason, status, decided_at)
           values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 1, 'manual', 'rejected', now())
           on conflict (coach_a, coach_b) do update set status = 'rejected', decided_at = now()`, [a.id, b.id])
      }
    }
  } finally {
    await c.end()
  }
}
main()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/seed-coach-decisions.ts
git commit -m "feat(coaches): seed script for the 2026-09-18 coach decisions"
```

---

### Task 14: Verification + rollout (each prod step needs Gustavo's confirmation)

- [ ] **Step 1: Full test + build pass (no prod)**

```bash
cd padelgod && npx vitest run && npx tsc --noEmit
cd ../apps/ops && npx vitest run && npx tsc --noEmit && npm run build
```
Expected: all green. Report counts.

- [ ] **Step 2: Ask Gustavo → apply migration**

Ask: "Apply `20261002_coaches.sql` to prod?" On yes, apply with pg + DATABASE_URL (repo practice; not `supabase db push`):

```bash
set -a; source .env.local; set +a; node -e "const{Client}=require('pg');const fs=require('fs');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(fs.readFileSync('supabase/migrations/20261002_coaches.sql','utf8'));console.log('applied');await c.end()})()"
```
Expected: `applied` (the ASSERT block would raise otherwise).

- [ ] **Step 3: Local dry run of the linker against prod data (read-only)**

Create a throwaway runner in the scratchpad (not committed) that calls `runCoachLinker({ supabase, logger, dryRun: true })` with a service-key client, or run padelgod locally with `ENABLE_COACH_LINKER=true COACH_LINKER_DRY_RUN=true`. Compare against the 2026-10-02 dry run: ~861 coaches created, ~128 subset + ~80 typo suggestions *minus* single-token pairs (expect fewer than 208), `D’antonio`/`Dantonio` collapsed into one coach. Report the numbers to Gustavo.

- [ ] **Step 4: Ask Gustavo → first real run**

On yes, run the same runner with `dryRun: false` once. Then verify with SQL:

```sql
select count(*) from coaches;                                   -- ≈ 860
select count(*) from player_coaches;                            -- ≈ 1,9xx (one row per player×coach)
select status, count(*) from coach_merge_suggestions group by 1;
select display_name, total_points from coach_stats order by total_points desc limit 10;  -- Pratto, Martínez, Canali, Gilardoni, Nerone…
```
Re-run the dry run: every write counter must be 0 (idempotence).

- [ ] **Step 5: Ask Gustavo → seed decisions**

`npx tsx scripts/seed-coach-decisions.ts` (dry) → show output → on yes, `--apply`.

- [ ] **Step 6: Admin check locally**

Start the admin dev server (`preview_start` with the ops config in `.claude/launch.json`; `npm install` in `apps/ops` first if needed). Verify, in both themes:
- `/players` → Players · Coaches · Review queue switch; `?view=coaches` loads the list sorted by points.
- Review queue: merge one low-stakes suggestion and reject one; both disappear; the rejected one does not come back after a linker dry run.
- Coach detail: edit display name, set status junk → it disappears from the default list; link a player → **Coach** tag shows on that player's row and detail, **Player** tag on the coach.
- Player detail: coaches render as links.
- ⌘K "pratto" → coach hit.
Screenshot for Gustavo.

- [ ] **Step 7: Ask Gustavo → PR + deploys**

Open the PR against `main`. On merge, padelgod auto-deploys (flag still off). Then, with go-ahead: set `ENABLE_COACH_LINKER=true`, `COACH_LINKER_DRY_RUN=false` on Railway; manual `railway up` from inside `apps/ops` for the admin (it does not auto-deploy — see memory `railway-deploy-mechanics`).

---

## Self-review notes

- Spec coverage: schema (T1), normalizer incl. apostrophe fix (T2), suggestions never auto-applied + durable rejections + single-token exclusion (T3, T1 `merge_coaches` carry-over), linker chain + idempotence + junk resolving (T4, T5), schedule/flag/dry-run (T6), admin inside Players tab + Coach/Player tags + player link (T9–T12), ⌘K (T12), seed decisions (T13), rollout with confirmation gates (T14).
- Deviations from the spec text, intentional: (a) `coach_stats` keeps junk rows (admin filters them) instead of excluding them; (b) on merge, the source's *pending* suggestions are deleted and regenerated by the next linker run instead of re-pointed (rejections ARE carried over); (c) a concurrent-run unique violation is handled by chunk isolation + self-healing next run rather than an in-run re-read. The spec is updated to match.
