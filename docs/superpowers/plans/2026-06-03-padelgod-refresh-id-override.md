# padelgod Refresh ID-Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make padelgod's on-demand refresh fetch data for a targeted tournament regardless of age, by letting an explicit tournament-id override bypass the ±7-day window in the two active-tournament RPCs.

**Architecture:** Add an optional `p_only_ids uuid[]` parameter to both `padelgod_active_tournaments_*` RPCs (window bypassed when ids are passed; entity requirements — active widget / slug — kept). The refresh-chain workers forward their `onlyTournamentIds` into the RPC via a shared helper. Scheduled workers call with no ids and stay windowed.

**Tech Stack:** PostgreSQL functions (Supabase) · Node/TypeScript (padelgod, Fastify workers) · Vitest · `pg` apply script.

**Spec:** `docs/superpowers/specs/2026-06-03-padelgod-refresh-id-override-design.md`

---

## File structure

**Create:**
- `padelgod/src/lib/active-tournament-args.ts` — pure helper building the RPC args.
- `padelgod/src/__tests__/lib/active-tournament-args.test.ts` — unit test.
- `supabase/migrations/20260603000004_padelgod_active_tournaments_id_override.sql` — redefine both RPCs.

**Modify (8 refresh-chain RPC call sites — add the args param):**
- `padelgod/src/workers/entry-list-fetcher.ts` (~:395, `_with_slug`)
- `padelgod/src/workers/draw-fetcher.ts` (~:120, `_for_static_workers`)
- `padelgod/src/workers/fip-draw-fetcher.ts` (~:306, `_with_slug`)
- `padelgod/src/workers/fip-draw-populator.ts` (~:519, `_with_slug`)
- `padelgod/src/workers/oop-fetcher.ts` (~:312, `_for_static_workers`)
- `padelgod/src/workers/fip-oop-writer.ts` (~:197, `_with_slug`)
- `padelgod/src/workers/results-fetcher.ts` (~:106, `_for_static_workers`)
- `padelgod/src/workers/fip-results-writer.ts` (~:131, `_with_slug`)

**Add tests (assert the param is forwarded):**
- `padelgod/src/__tests__/workers/draw-fetcher.test.ts` (extend)
- `padelgod/src/__tests__/workers/entry-list-fetcher.test.ts` (extend)

**Commands:** test `cd padelgod && npx vitest run <file>` · build `cd padelgod && npm run build` (if defined) or `npx tsc --noEmit` · migration apply via `pg` script (see Task 2).

---

## Task 1: Shared `activeTournamentArgs` helper (TDD)

**Files:**
- Create: `padelgod/src/lib/active-tournament-args.ts`
- Test: `padelgod/src/__tests__/lib/active-tournament-args.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/__tests__/lib/active-tournament-args.test.ts
import { describe, it, expect } from 'vitest';
import { activeTournamentArgs } from '../../lib/active-tournament-args.js';

describe('activeTournamentArgs', () => {
  it('returns empty args when no ids (scheduled run → windowed)', () => {
    expect(activeTournamentArgs(undefined)).toEqual({});
    expect(activeTournamentArgs(new Set())).toEqual({});
  });

  it('returns p_only_ids array when ids are present (targeted refresh → bypass)', () => {
    const args = activeTournamentArgs(new Set(['a', 'b']));
    expect(args).toEqual({ p_only_ids: ['a', 'b'] });
  });

  it('preserves a single id', () => {
    expect(activeTournamentArgs(new Set(['x']))).toEqual({ p_only_ids: ['x'] });
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `cd padelgod && npx vitest run src/__tests__/lib/active-tournament-args.test.ts`
Expected: FAIL — `Cannot find module '../../lib/active-tournament-args.js'`.

- [ ] **Step 3: Implement the helper**

```ts
// padelgod/src/lib/active-tournament-args.ts
//
// Builds the args object for the active-tournament RPCs
// (padelgod_active_tournaments_for_static_workers / _with_slug).
//
// Scheduled worker runs pass no ids → {} → the RPC applies its ±7-day
// window as before. The on-demand refresh passes the targeted tournament
// id(s) → { p_only_ids } → the RPC returns exactly those, bypassing the
// window (it still requires the tournament's active widget / slug). This is
// what lets an operator refresh a finished, out-of-window event.

export function activeTournamentArgs(
  onlyTournamentIds?: Set<string>,
): { p_only_ids?: string[] } {
  return onlyTournamentIds && onlyTournamentIds.size > 0
    ? { p_only_ids: Array.from(onlyTournamentIds) }
    : {};
}
```

- [ ] **Step 4: Run the test — confirm it passes**

Run: `cd padelgod && npx vitest run src/__tests__/lib/active-tournament-args.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/active-tournament-args.ts padelgod/src/__tests__/lib/active-tournament-args.test.ts
git commit -m "feat(padelgod): activeTournamentArgs helper for RPC id-override"
```

---

## Task 2: Migration — add `p_only_ids` override to both RPCs

**Files:**
- Create: `supabase/migrations/20260603000004_padelgod_active_tournaments_id_override.sql`

The two functions currently take **0 args**. Adding a `DEFAULT NULL` parameter changes the signature, so we must **DROP the old 0-arg functions first** (otherwise Postgres keeps both as overloads and a no-arg `.rpc()` call resolves to the old windowed one). After redefining, `NOTIFY pgrst` so PostgREST exposes the new parameter.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260603000004_padelgod_active_tournaments_id_override.sql
--
-- Add an optional p_only_ids override to the two active-tournament RPCs so a
-- targeted on-demand refresh can fetch a tournament OUTSIDE the ±7-day window.
-- When p_only_ids is NULL (scheduled runs, no-arg calls) the original window
-- applies unchanged. Entity requirements are kept: _for_static_workers still
-- requires an active Crionet widget; _with_slug still requires a slug.
--
-- The old 0-arg signatures are dropped first so the new DEFAULT-NULL single-arg
-- versions fully replace them (no overload ambiguity).

DROP FUNCTION IF EXISTS public.padelgod_active_tournaments_for_static_workers();
DROP FUNCTION IF EXISTS public.padelgod_active_tournaments_with_slug();

CREATE OR REPLACE FUNCTION public.padelgod_active_tournaments_for_static_workers(
  p_only_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  widget_id TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  expected_days INT
) AS $$
  SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    c.widget_id,
    t.starts_at,
    t.ends_at,
    GREATEST(
      1,
      CASE
        WHEN t.starts_at IS NOT NULL AND t.ends_at IS NOT NULL
          THEN EXTRACT(DAY FROM (t.ends_at - t.starts_at))::INT + 1
        ELSE 7
      END
    ) AS expected_days
  FROM public.tournaments t
  INNER JOIN padelgod.widget_id_cache c
    ON c.tournament_id = t.id AND c.is_active = true
  WHERE (
    -- targeted refresh: return these ids regardless of the date window
    (p_only_ids IS NOT NULL AND t.id = ANY(p_only_ids))
    -- scheduled / no-arg: original ±7-day window
    OR (p_only_ids IS NULL AND (
      t.starts_at IS NULL
      OR (t.starts_at <= NOW() + INTERVAL '7 days'
          AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days')
    ))
  )
  ORDER BY t.starts_at ASC NULLS LAST
  LIMIT 50;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.padelgod_active_tournaments_with_slug(
  p_only_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  slug TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ
) AS $$
  SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    t.slug,
    t.starts_at,
    t.ends_at
  FROM public.tournaments t
  WHERE t.slug IS NOT NULL
    AND (
      (p_only_ids IS NOT NULL AND t.id = ANY(p_only_ids))
      OR (p_only_ids IS NULL AND (
        t.starts_at IS NULL
        OR (t.starts_at <= NOW() + INTERVAL '7 days'
            AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days')
      ))
    )
  ORDER BY t.starts_at ASC NULLS LAST
  LIMIT 50;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='padelgod_active_tournaments_for_static_workers'), 'static fn missing';
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='padelgod_active_tournaments_with_slug'), 'slug fn missing';
END $$;

-- Reload PostgREST's schema cache so the new parameter is exposed via .rpc().
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply the migration to the DB and verify the override**

Create `padelgod/_tmp_apply_idoverride.mjs` (DELETE after running), mirroring the repo's `pg`-apply pattern (reads `DATABASE_URL` from the repo-root `.env.local`):

```js
import fs from 'fs'; import { Client } from 'pg';
const env = fs.readFileSync('../.env.local','utf8');
for (const line of env.split('\n')) { const t=line.trim(); if(!t||t.startsWith('#'))continue; const eq=t.indexOf('='); if(eq===-1)continue; const k=t.slice(0,eq).trim(); const v=t.slice(eq+1).trim().replace(/^["']|["']$/g,''); if(!process.env[k])process.env[k]=v; }
const sql = fs.readFileSync('../supabase/migrations/20260603000004_padelgod_active_tournaments_id_override.sql','utf8');
const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
try {
  await c.query(sql);
  // FIP SILVER AUSTRALIAN PADEL OPEN — finished Jan, has active widget, out of window.
  const id = '7fc86d61-34d5-4771-96da-7bfbf9aaeab7';
  const targeted = await c.query("select count(*)::int n from padelgod_active_tournaments_for_static_workers(array[$1]::uuid[])", [id]);
  const windowed = await c.query("select count(*)::int n from padelgod_active_tournaments_for_static_workers()");
  console.log('targeted (expect 1):', targeted.rows[0].n);
  console.log('windowed no-arg (current in-window count):', windowed.rows[0].n);
} finally { await c.end(); }
```

Run: `cd padelgod && node _tmp_apply_idoverride.mjs && rm -f _tmp_apply_idoverride.mjs`
Expected: `targeted (expect 1): 1` (the out-of-window tournament is now returned because it has an active widget); `windowed no-arg` prints whatever the current in-window count is (unchanged behavior). If `targeted` is 0, STOP — either the id lacks an active widget row or the WHERE bypass is wrong.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260603000004_padelgod_active_tournaments_id_override.sql
git commit -m "feat(db): p_only_ids override on padelgod active-tournament RPCs"
```

---

## Task 3: Forward `onlyTournamentIds` from the 8 refresh-chain call sites

Each of these workers already destructures `onlyTournamentIds` from its deps and calls one of the two RPCs with **no args**, then post-filters the result. We pass `activeTournamentArgs(onlyTournamentIds)` as the RPC args. The post-`.filter()` stays as a harmless guard.

**The transform (identical at every site):**

```ts
// before
const { data, error } = await deps.supabase.rpc('padelgod_active_tournaments_for_static_workers')
// after
import { activeTournamentArgs } from '../lib/active-tournament-args.js'   // add near other imports
const { data, error } = await deps.supabase.rpc(
  'padelgod_active_tournaments_for_static_workers',
  activeTournamentArgs(deps.onlyTournamentIds),
)
```

Use the correct RPC name per site and the correct accessor for `onlyTournamentIds` (some files destructure `const { onlyTournamentIds } = deps` — use whatever local name exists; if the worker reads `deps.onlyTournamentIds`, pass that).

- [ ] **Step 1: Apply the transform at all 8 sites.** For each file, add the import (path `'../lib/active-tournament-args.js'`) and pass `activeTournamentArgs(<onlyTournamentIds expr>)` as the second arg to the existing `.rpc(...)` call:

  - `padelgod/src/workers/entry-list-fetcher.ts` — `.rpc('padelgod_active_tournaments_with_slug')`
  - `padelgod/src/workers/draw-fetcher.ts` — `.rpc('padelgod_active_tournaments_for_static_workers')`
  - `padelgod/src/workers/fip-draw-fetcher.ts` — `.rpc('padelgod_active_tournaments_with_slug')`
  - `padelgod/src/workers/fip-draw-populator.ts` — `.rpc('padelgod_active_tournaments_with_slug')`
  - `padelgod/src/workers/oop-fetcher.ts` — `.rpc('padelgod_active_tournaments_for_static_workers')`
  - `padelgod/src/workers/fip-oop-writer.ts` — `.rpc('padelgod_active_tournaments_with_slug')`
  - `padelgod/src/workers/results-fetcher.ts` — `.rpc('padelgod_active_tournaments_for_static_workers')`
  - `padelgod/src/workers/fip-results-writer.ts` — `.rpc('padelgod_active_tournaments_with_slug')`

  Grep to confirm each call site and that `onlyTournamentIds` is available in scope there:
  `cd padelgod && grep -n "padelgod_active_tournaments\|onlyTournamentIds" src/workers/<file>`

- [ ] **Step 2: Extend draw-fetcher test to assert the param is forwarded**

In `padelgod/src/__tests__/workers/draw-fetcher.test.ts`, the existing `fakeSupabase` already does `rpc: vi.fn(async () => ({ data: activeTournaments, error: null }))`. Add:

```ts
it('passes p_only_ids to the RPC when onlyTournamentIds is set (targeted refresh)', async () => {
  const supabase = fakeSupabase([]);
  const httpClient = { get: vi.fn() };
  await runDrawFetcher({
    supabase: supabase as any,
    httpClient: httpClient as any,
    onlyTournamentIds: new Set(['7fc86d61-34d5-4771-96da-7bfbf9aaeab7']),
  });
  expect(supabase.rpc).toHaveBeenCalledWith(
    'padelgod_active_tournaments_for_static_workers',
    { p_only_ids: ['7fc86d61-34d5-4771-96da-7bfbf9aaeab7'] },
  );
});

it('omits p_only_ids when no onlyTournamentIds (scheduled run stays windowed)', async () => {
  const supabase = fakeSupabase([]);
  const httpClient = { get: vi.fn() };
  await runDrawFetcher({ supabase: supabase as any, httpClient: httpClient as any });
  expect(supabase.rpc).toHaveBeenCalledWith(
    'padelgod_active_tournaments_for_static_workers',
    {},
  );
});
```

- [ ] **Step 3: Run the draw-fetcher test — confirm both pass**

Run: `cd padelgod && npx vitest run src/__tests__/workers/draw-fetcher.test.ts`
Expected: PASS (existing tests + the 2 new assertions).

- [ ] **Step 4: Add the same two assertions to entry-list-fetcher test**

In `padelgod/src/__tests__/workers/entry-list-fetcher.test.ts`, find how it constructs its fake supabase + calls `runEntryListFetcher`, and add the analogous pair — asserting `supabase.rpc` is called with `('padelgod_active_tournaments_with_slug', { p_only_ids: [<id>] })` when `onlyTournamentIds` is set, and with `('padelgod_active_tournaments_with_slug', {})` when not. (Mirror the existing test's setup helper; the RPC name is `_with_slug` here.)

Run: `cd padelgod && npx vitest run src/__tests__/workers/entry-list-fetcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/ padelgod/src/__tests__/workers/draw-fetcher.test.ts padelgod/src/__tests__/workers/entry-list-fetcher.test.ts
git commit -m "feat(padelgod): refresh-chain workers forward onlyTournamentIds as p_only_ids"
```

---

## Task 4: Verify — full test suite + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Full padelgod test suite green**

Run: `cd padelgod && npx vitest run`
Expected: all PASS (no regressions in the other ~9 worker tests that mock `rpc`; their `rpc: vi.fn()` ignores extra args, so passing `{}` doesn't break them).

- [ ] **Step 2: Typecheck / build**

Run: `cd padelgod && npm run build` (if a build script exists) — else `cd padelgod && npx tsc --noEmit`
Expected: no type errors. (`activeTournamentArgs` returns `{ p_only_ids?: string[] }`, accepted by supabase-js `.rpc(name, args)`.)

- [ ] **Step 3: Confirm scheduled-only callers untouched**

Run: `cd padelgod && grep -rn "padelgod_active_tournaments" src/workers/fip-winner-propagator.ts src/workers/fip-draw-reconciler.ts src/workers/fip-draw-linker.ts src/workers/fip-draw-results-writer.ts`
Expected: these still call the RPC with **no args** (they don't receive `onlyTournamentIds` from the refresh chain) — confirming scheduled behavior is unchanged.

- [ ] **Step 4: Commit any fixups (if needed)**

```bash
git add -A && git commit -m "chore(padelgod): id-override verification fixups"
```

---

## Rollout (post-merge — NOT part of the coded tasks)

1. The migration is already applied to the shared DB in Task 2. (Confirm it's also captured in `supabase/migrations/` for any fresh environments — it is.)
2. **Deploy padelgod to Railway** so the worker code change is live (the local ops Refresh button calls the prod padelgod service).
3. End-to-end: from Data Readiness, Refresh **FIP-2026-0225** (FIP Silver Australian Padel Open):
   - Crionet still has it → `✓ +N matches`, row flips toward OK.
   - Crionet purged it → `✓ no new data` (honest label) → it's a Crionet-retention limit, not worker scope.

## Self-review notes (author)

- **Spec coverage:** RPC `p_only_ids` override w/ kept entity requirements (Task 2); refresh-chain workers forward ids, scheduled untouched (Task 3 + Task 4 Step 3); helper (Task 1); tests (Tasks 1,3); self-revealing rollout (Rollout). All covered.
- **Signature subtlety:** DROP old 0-arg functions before re-create + `NOTIFY pgrst` (Task 2) — prevents overload ambiguity and stale PostgREST cache.
- **Type consistency:** `activeTournamentArgs(onlyTournamentIds?: Set<string>) → { p_only_ids?: string[] }` used identically in helper, workers, and test assertions (`{ p_only_ids: [...] }` / `{}`).
- **No-regression:** other workers' `rpc: vi.fn()` mocks ignore the new 2nd arg; scheduled callers keep no-arg calls.
