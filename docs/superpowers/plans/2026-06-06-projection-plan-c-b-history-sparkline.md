# Projection — Plan C-B: champion-odds history + sparkline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record each pair's champion/finalist/semifinal odds every hourly run and show a champion-odds **sparkline** on the Projection tab hero — "the journey" of a pair's title odds through the event.

**Architecture:** A new append-only `tournament_projection_snapshots` table (public-read). The projection worker appends one row per pair per run. A client hook reads a pair's series; a tiny inline-SVG `ChampionSparkline` renders it on the hero.

**Tech Stack:** Supabase migration, padelgod worker, public Next.js app, vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-projection-history-and-eliminated-pairs-design.md`
**Depends on:** Plan C-A (full-field worker; eliminated/champion UI).

**Scope:** History + sparkline only. Full road-scrubber is the deferred B2.

---

## Task 1: Migration — `tournament_projection_snapshots`

**Files:**
- Create: `supabase/migrations/20260606140000_tournament_projection_snapshots.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260606140000_tournament_projection_snapshots.sql
-- Append-only history of per-pair tournament odds, for the champion-odds
-- sparkline. Public-read (anon); service-role writes. Mirrors match_live_odds_snapshots.
create table if not exists public.tournament_projection_snapshots (
  id             bigint generated always as identity primary key,
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  category       text not null check (category in ('men','women')),
  pair_key       text not null,
  champion_prob  numeric(5,4) not null,
  finalist_prob  numeric(5,4) not null,
  semifinal_prob numeric(5,4) not null,
  computed_at    timestamptz not null default now()
);
create index if not exists tournament_projection_snapshots_lookup_idx
  on public.tournament_projection_snapshots (tournament_id, category, pair_key, computed_at);

alter table public.tournament_projection_snapshots enable row level security;
drop policy if exists tournament_projection_snapshots_read on public.tournament_projection_snapshots;
create policy tournament_projection_snapshots_read
  on public.tournament_projection_snapshots for select to anon, authenticated using (true);
```

- [ ] **Step 2: Apply (pg driver) + verify**

Apply via `DATABASE_URL` one-shot (per `memory/repo-migration-apply-method.md`), then:
```bash
psql "$DATABASE_URL" -c "\d public.tournament_projection_snapshots"
psql "$DATABASE_URL" -c "select count(*) from public.tournament_projection_snapshots;"
```
Expected: table exists, RLS on, count 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606140000_tournament_projection_snapshots.sql
git commit -m "feat(projection): tournament_projection_snapshots table + RLS"
```

---

## Task 2: Worker — append snapshot rows each run

**Files:**
- Modify: `padelgod/src/workers/tournament-projection-snapshot.ts`
- Modify: `padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts`

- [ ] **Step 1: Add a failing test for the snapshot-row builder**

The append payload is a pure transform of the projections; test that helper. Append to the worker test file:

```ts
import { buildSnapshotRows } from '../tournament-projection-snapshot.js'

describe('buildSnapshotRows', () => {
  it('maps each projection to a snapshot row with the run timestamp', () => {
    const projections = new Map([
      ['a::b', { pairKey: 'a::b', playerIds: ['a','b'] as [string,string], championProb: 0.22, finalistProb: 0.4, semifinalProb: 0.7, rounds: [] }],
    ])
    const rows = buildSnapshotRows(projections, 't1', 'men', '2026-06-06T10:00:00.000Z')
    expect(rows).toEqual([{
      tournament_id: 't1', category: 'men', pair_key: 'a::b',
      champion_prob: '0.2200', finalist_prob: '0.4000', semifinal_prob: '0.7000',
      computed_at: '2026-06-06T10:00:00.000Z',
    }])
  })
})
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd padelgod && npx vitest run src/workers/__tests__/tournament-projection-snapshot.test.ts`
Expected: FAIL — `buildSnapshotRows` not exported.

- [ ] **Step 3: Implement the builder + wire the append**

Add to `tournament-projection-snapshot.ts` (near the other helpers); import the type if needed (`PairProjection` from `../lib/bracket-projection.js`):

```ts
import { projectPairs, PROJ_ROUND_ORDER, matchupKey, type PairProjection } from '../lib/bracket-projection.js'

export function buildSnapshotRows(
  projections: Map<string, PairProjection>,
  tournamentId: string,
  category: 'men' | 'women',
  computedAtIso: string,
) {
  return [...projections.values()].map((p) => ({
    tournament_id: tournamentId,
    category,
    pair_key: p.pairKey,
    champion_prob: p.championProb.toFixed(4),
    finalist_prob: p.finalistProb.toFixed(4),
    semifinal_prob: p.semifinalProb.toFixed(4),
    computed_at: computedAtIso,
  }))
}
```

In the worker's per-category block, right after the `tournament_projections` insert succeeds (inside `if (!dryRun …)`), append history:
```ts
          const snapRows = buildSnapshotRows(projections, t.id, category, nowIso)
          if (snapRows.length > 0) {
            const { error: snapErr } = await supabase.from('tournament_projection_snapshots').insert(snapRows)
            if (snapErr) throw snapErr
          }
```
(Place it after `if (error) throw error;` for the projections insert, still inside the `!dryRun` guard.)

- [ ] **Step 4: Run worker tests + typecheck**

Run: `cd padelgod && npx vitest run src/workers/__tests__/tournament-projection-snapshot.test.ts && npx tsc --noEmit 2>&1 | grep tournament-projection-snapshot || echo CLEAN`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/tournament-projection-snapshot.ts padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts
git commit -m "feat(projection): worker appends champion-odds history snapshots"
```

---

## Task 3: Public history hook

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/useProjectionHistory.ts`

- [ ] **Step 1: Implement the hook**

```ts
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface ProjectionHistoryPoint {
  champion_prob: number
  computed_at: string
}

/** Reads a pair's champion-odds series (chronological) for the sparkline. */
export function useProjectionHistory(
  tournamentId: string,
  category: 'men' | 'women',
  pairKey: string | null,
): ProjectionHistoryPoint[] {
  const [points, setPoints] = useState<ProjectionHistoryPoint[]>([])
  useEffect(() => {
    if (!pairKey) { setPoints([]); return }
    let cancelled = false
    supabase
      .from('tournament_projection_snapshots')
      .select('champion_prob, computed_at')
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .eq('pair_key', pairKey)
      .order('computed_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.warn('[useProjectionHistory] fetch failed:', error); setPoints([]); return }
        setPoints((data ?? []) as ProjectionHistoryPoint[])
      })
    return () => { cancelled = true }
  }, [tournamentId, category, pairKey])
  return points
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep useProjectionHistory || echo CLEAN`
```bash
git add "src/app/[locale]/(app)/tournaments/[id]/useProjectionHistory.ts"
git commit -m "feat(projection-ui): champion-odds history hook"
```

---

## Task 4: ChampionSparkline component

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/ChampionSparkline.tsx`
- Test: `src/lib/__tests__/sparkline-path.test.ts`
- Create: `src/lib/sparkline-path.ts` (pure path math, testable)

- [ ] **Step 1: Failing test for the pure path math**

`src/lib/__tests__/sparkline-path.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { sparklinePoints } from '@/lib/sparkline-path'

describe('sparklinePoints', () => {
  it('maps values to x,y across the box (y inverted; higher value = higher up)', () => {
    const pts = sparklinePoints([0, 0.5, 1], 100, 20)
    expect(pts[0]).toEqual({ x: 0, y: 20 })      // value 0 → bottom
    expect(pts[2]).toEqual({ x: 100, y: 0 })     // value 1 → top
    expect(pts[1]).toEqual({ x: 50, y: 10 })     // midpoint
  })
  it('handles a flat series without NaN', () => {
    const pts = sparklinePoints([0.3, 0.3], 100, 20)
    expect(pts.every(p => Number.isFinite(p.y))).toBe(true)
  })
})
```

- [ ] **Step 2: Run, confirm fail; then implement** `src/lib/sparkline-path.ts`:

```ts
export interface SparkPoint { x: number; y: number }

/** Map a value series to points in a [w × h] box. Values are clamped to [0,1];
 *  y is inverted (1 → top). x is evenly spaced. Flat series renders mid-safe. */
export function sparklinePoints(values: number[], w: number, h: number): SparkPoint[] {
  const n = values.length
  if (n === 0) return []
  return values.map((v, i) => {
    const clamped = Math.max(0, Math.min(1, v))
    const x = n === 1 ? 0 : (i / (n - 1)) * w
    const y = h - clamped * h
    return { x, y }
  })
}
```
Run the test → PASS.

- [ ] **Step 3: Implement the component** `ChampionSparkline.tsx`:

```tsx
'use client'
import { useProjectionHistory } from './useProjectionHistory'
import { sparklinePoints } from '@/lib/sparkline-path'

const LIME = '#7ED321'
const W = 96
const H = 22

export default function ChampionSparkline({
  tournamentId, category, pairKey,
}: { tournamentId: string; category: 'men' | 'women'; pairKey: string | null }) {
  const points = useProjectionHistory(tournamentId, category, pairKey)
  if (points.length < 2) return null
  const pts = sparklinePoints(points.map((p) => p.champion_prob), W, H)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={LIME} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={2} fill={LIME} />
    </svg>
  )
}
```

- [ ] **Step 4: Mount it on the hero in `ProjectionTab.tsx`**

Import: `import ChampionSparkline from './ChampionSparkline'`. In the champion hero's right-hand column (under the `champion` label / status badge), add:
```tsx
              <div style={{ marginTop: 4 }}>
                <ChampionSparkline tournamentId={tournamentId} category={category} pairKey={activePair} />
              </div>
```
(It self-hides when <2 points, so no layout jump before history accrues.)

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npx vitest run src/lib/__tests__/sparkline-path.test.ts` (PASS), `npx tsc --noEmit 2>&1 | grep -E "Sparkline|sparkline" || echo CLEAN`, `npx eslint "src/app/[locale]/(app)/tournaments/[id]/ChampionSparkline.tsx"`.
```bash
git add src/lib/sparkline-path.ts src/lib/__tests__/sparkline-path.test.ts "src/app/[locale]/(app)/tournaments/[id]/ChampionSparkline.tsx" "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"
git commit -m "feat(projection-ui): champion-odds sparkline on the hero"
```

---

## Task 5: Seed history + verify locally

A sparkline needs ≥2 snapshots; rather than wait an hour, seed a second timestamped point.

- [ ] **Step 1: Ensure ≥2 snapshot rows for a test pair**

The C-A worker run already wrote one snapshot row per pair (if run after C-B Task 2; if not, run the worker once). To get a 2nd point with a different `computed_at`, run the worker again (it appends) OR insert a synthetic earlier point for one pair via pg:
```bash
psql "$DATABASE_URL" -c "insert into public.tournament_projection_snapshots (tournament_id, category, pair_key, champion_prob, finalist_prob, semifinal_prob, computed_at) select tournament_id, category, pair_key, greatest(champion_prob-0.05,0), finalist_prob, semifinal_prob, computed_at - interval '2 hours' from public.tournament_projection_snapshots where pair_key is not null limit 50;"
```
(Synthetic backfill is test-only; real history accrues hourly in prod.)

- [ ] **Step 2: Verify in the running public app**

Boot the public app (flag on). On ITALY MAJOR's Projection tab, an active pair's hero shows a small lime sparkline trending toward its current champion %. Switch pairs → the sparkline updates. Per `memory/feedback_test-locally.md`, confirm in the browser; check console for errors.

- [ ] **Step 3: No commit** (synthetic seed is DB-only/test). Report what you observed.

---

## Self-review (done during authoring)

**Spec coverage (C-B):** append-only snapshots table → Task 1; worker append → Task 2; history hook → Task 3; sparkline (pure math tested + component) → Task 4; local verify → Task 5. Retention noted as future (spec). ✓
**Placeholder scan:** none.
**Type consistency:** `buildSnapshotRows`, `useProjectionHistory`/`ProjectionHistoryPoint`, `sparklinePoints`/`SparkPoint`, `ChampionSparkline` props consistent across tasks. Snapshot columns match the migration exactly (`champion_prob`/`finalist_prob`/`semifinal_prob`/`computed_at`).

## Deferred (B2)
Full road-snapshot time-travel / scrubber (store entire `rounds` per snapshot + a time-slider UI).
