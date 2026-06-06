# Road to Trophy — Plan A: Projection engine + table + worker + admin QA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute per-pair tournament projections (champion odds + per-round opponent distribution + win %) from the existing Elo model, persist them to a publicly-readable `tournament_projections` table via an hourly padelgod worker, and expose them in `apps/ops` across all tiers for QA.

**Architecture:** A new **bracket-structure-aware** Monte-Carlo engine (`padelgod/src/lib/bracket-projection.ts`) simulates the real remaining draw — unlike the existing `model_tournament_predictions` MC, which reshuffles pairs each run and therefore can't yield per-round opponent distributions. A worker (`tournament-projection-snapshot`) trains Elo (reusing `elo-model.ts`), orders each tournament's current bracket frontier, runs the engine, and UPSERTs rows. The public app and admin both read the table; this plan delivers the engine, table, worker, and the admin QA surface. The public Projection tab + player card are **Plan B**.

**Tech Stack:** TypeScript, padelgod Railway worker (Node + vitest), Supabase Postgres (SQL migration + RLS), `apps/ops` Next.js admin.

**Spec:** `docs/superpowers/specs/2026-06-06-road-to-trophy-projection-design.md`

**Scope note:** This plan is backend + admin only. It produces working, testable software: projections computed hourly and inspectable in the ops admin for every tier. Plan B consumes the `tournament_projections` table for the public UI.

---

## Key design decisions (read before starting)

1. **New engine, not the existing `monteCarlo`.** `model-prediction-snapshot.ts`'s `monteCarlo()` calls `shuffle()` every run, ignoring bracket structure. The road needs *who you'd actually meet at each round*, which depends on the real draw. So we build a structure-aware engine.

2. **Engine is pure and decoupled from the Next `Match` type.** It takes an ordered array of frontier entrants (competitor pairs, in bracket order, power-of-2 length, `null` for byes/TBD) + team Elos + an injectable RNG. It does NOT import `bracket-builder.ts` (that lives in the Next app and depends on `@/types/match`). The worker is responsible for ordering entrants from DB rows.

3. **Finished matches in the frontier round are respected via the bye mechanism.** When building entrants, a finished frontier match becomes `[winnerPair, null]` (winner advances free); an unfinished one becomes `[pair1, pair2]`. No engine-level "result override" needed. Earlier rounds are already finished (frontier = earliest round with an unfinished match); later rounds haven't started.

4. **All tiers are computed and stored** (admin QA needs lower tiers). The public app (Plan B) only queries Premier rows. `tournament_level` is denormalized onto each row for filtering.

5. **Round vocabulary** matches `bracket-builder.ts`: `R64 R32 R16 QF SF F`. The engine derives round labels from `entrants.length` (`log2(len)` deepest rounds — 8 entrants → `QF,SF,F`).

---

## File structure

**Create:**
- `padelgod/src/lib/bracket-projection.ts` — pure MC engine + types.
- `padelgod/src/lib/__tests__/bracket-projection.test.ts` — engine unit tests.
- `padelgod/src/workers/tournament-projection-snapshot.ts` — the worker.
- `padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts` — worker unit tests (stubbed supabase).
- `supabase/migrations/20260606120000_tournament_projections.sql` — table + RLS + indexes.
- `apps/ops/src/lib/projection-data.ts` — admin read helper.
- `apps/ops/src/app/(app)/odds/projections/page.tsx` — admin QA page.

**Modify:**
- `padelgod/src/lib/env.ts` — add `ENABLE_TOURNAMENT_PROJECTION_SNAPSHOT` + `TOURNAMENT_PROJECTION_SNAPSHOT_DRY_RUN`.
- `padelgod/src/index.ts` — wire env → flags.
- `padelgod/src/scheduler.ts` — flags interface, admin-trigger case, cron entry.

---

## Task 1: Engine types + single-elimination simulation core

**Files:**
- Create: `padelgod/src/lib/bracket-projection.ts`
- Test: `padelgod/src/lib/__tests__/bracket-projection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/bracket-projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectPairs, type FrontierEntrant } from '../bracket-projection.js';

// Deterministic RNG (mulberry32) so MC results are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pair(key: string, elo: number): FrontierEntrant {
  return { pairKey: key, playerIds: [`${key}-a`, `${key}-b`], teamElo: elo };
}

describe('projectPairs', () => {
  it('gives ~equal champion odds to 4 equal-Elo pairs over an SF/F bracket', () => {
    const entrants = [pair('A', 1800), pair('B', 1800), pair('C', 1800), pair('D', 1800)];
    const res = projectPairs({ entrants, runs: 20000, rng: mulberry32(42) });
    for (const k of ['A', 'B', 'C', 'D']) {
      expect(res.get(k)!.championProb).toBeGreaterThan(0.20);
      expect(res.get(k)!.championProb).toBeLessThan(0.30);
    }
    // Round labels for 4 entrants are SF then F.
    expect(res.get('A')!.rounds.map(r => r.round)).toEqual(['SF', 'F']);
  });

  it('reports the analytic conditional win prob against each SF opponent', () => {
    // A is much stronger; B/C/D equal. A meets B or... in SF A meets its
    // bracket neighbor (index 0 vs 1 => A vs B). winProb is analytic.
    const entrants = [pair('A', 2000), pair('B', 1600), pair('C', 1800), pair('D', 1800)];
    const res = projectPairs({ entrants, runs: 5000, rng: mulberry32(7) });
    const aSF = res.get('A')!.rounds.find(r => r.round === 'SF')!;
    const oppB = aSF.opponents.find(o => o.pairKey === 'B')!;
    // pairWinProbability(2000,1600) = 1/(1+10^(-400/400)) = 0.909...
    expect(oppB.winProb).toBeCloseTo(0.9090909, 4);
    // A always meets B in the SF (fixed bracket neighbor), so reachProb≈1.
    expect(oppB.reachProb).toBeGreaterThan(0.99);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/bracket-projection.test.ts`
Expected: FAIL — "Cannot find module '../bracket-projection.js'".

- [ ] **Step 3: Write the engine**

Create `padelgod/src/lib/bracket-projection.ts`:

```ts
// Pure, bracket-structure-aware Monte-Carlo projection engine.
// Unlike model-prediction-snapshot's monteCarlo() (which reshuffles pairs each
// run), this simulates the REAL remaining draw so we can report, per pair and
// per round: the probability of reaching the round, the distribution of
// opponents met there, and the analytic win prob against each.
//
// No dependency on the Next app's bracket-builder or @/types/match. The caller
// supplies frontier entrants already ordered in bracket order (index 2k vs
// 2k+1 are first-round opponents). Length must be a power of two; null = bye/TBD.

import { pairWinProbability } from './elo-model.js';

export type ProjRound = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F';
export const PROJ_ROUND_ORDER: ProjRound[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'];

export interface FrontierEntrant {
  pairKey: string;
  playerIds: [string, string];
  teamElo: number;
}

export interface ProjectionInput {
  /** Bracket-ordered competitors entering the frontier round. Power-of-2
   *  length; null = bye or not-yet-known. Index 2k vs 2k+1 are opponents. */
  entrants: (FrontierEntrant | null)[];
  runs: number;
  /** Injectable for deterministic tests. Defaults to Math.random. */
  rng?: () => number;
}

export interface OpponentChance {
  pairKey: string;
  playerIds: [string, string];
  /** Unconditional P(tracked pair reaches this round AND faces this opponent). */
  reachProb: number;
  /** Analytic P(tracked beats this opponent | they meet). */
  winProb: number;
}

export interface PairRound {
  round: ProjRound;
  /** P(tracked pair competes in this round). */
  reachProb: number;
  opponents: OpponentChance[];
}

export interface PairProjection {
  pairKey: string;
  playerIds: [string, string];
  championProb: number;
  finalistProb: number;
  semifinalProb: number;
  rounds: PairRound[];
}

function isPow2(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

export function projectPairs(input: ProjectionInput): Map<string, PairProjection> {
  const { entrants, runs } = input;
  const rng = input.rng ?? Math.random;
  if (!isPow2(entrants.length)) {
    throw new Error(`entrants.length must be a power of 2, got ${entrants.length}`);
  }

  const numRounds = Math.log2(entrants.length);
  const roundLabels = PROJ_ROUND_ORDER.slice(PROJ_ROUND_ORDER.length - numRounds);

  // Per-pair tallies.
  type Tally = {
    entrant: FrontierEntrant;
    reach: number[];                          // reach[roundIdx] = count
    champ: number;
    opp: Map<number, Map<string, number>>;    // roundIdx -> oppKey -> meet count
  };
  const tally = new Map<string, Tally>();
  for (const e of entrants) {
    if (e) {
      tally.set(e.pairKey, {
        entrant: e,
        reach: new Array(numRounds).fill(0),
        champ: 0,
        opp: new Map(),
      });
    }
  }

  const noteOpp = (t: Tally, roundIdx: number, oppKey: string) => {
    let m = t.opp.get(roundIdx);
    if (!m) { m = new Map(); t.opp.set(roundIdx, m); }
    m.set(oppKey, (m.get(oppKey) ?? 0) + 1);
  };

  for (let run = 0; run < runs; run++) {
    let level: (FrontierEntrant | null)[] = entrants;
    for (let r = 0; r < numRounds; r++) {
      // Record reach for everyone alive at the start of this round.
      for (const e of level) if (e) tally.get(e.pairKey)!.reach[r]++;
      const next: (FrontierEntrant | null)[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const a = level[i] ?? null;
        const b = level[i + 1] ?? null;
        if (a && b) {
          noteOpp(tally.get(a.pairKey)!, r, b.pairKey);
          noteOpp(tally.get(b.pairKey)!, r, a.pairKey);
          const pA = pairWinProbability(a.teamElo, b.teamElo);
          next.push(rng() < pA ? a : b);
        } else {
          next.push(a ?? b); // bye (or null vs null)
        }
      }
      level = next;
    }
    const champ = level[0];
    if (champ) tally.get(champ.pairKey)!.champ++;
  }

  const fIdx = roundLabels.indexOf('F');
  const sfIdx = roundLabels.indexOf('SF');

  const out = new Map<string, PairProjection>();
  for (const [key, t] of tally) {
    const rounds: PairRound[] = roundLabels.map((round, rIdx) => {
      const oppMap = t.opp.get(rIdx) ?? new Map<string, number>();
      const opponents: OpponentChance[] = [...oppMap.entries()]
        .map(([oppKey, count]) => {
          const opp = tally.get(oppKey)!.entrant;
          return {
            pairKey: oppKey,
            playerIds: opp.playerIds,
            reachProb: count / runs,
            winProb: pairWinProbability(t.entrant.teamElo, opp.teamElo),
          };
        })
        .sort((x, y) => y.reachProb - x.reachProb);
      return { round, reachProb: t.reach[rIdx] / runs, opponents };
    });
    out.set(key, {
      pairKey: key,
      playerIds: t.entrant.playerIds,
      championProb: t.champ / runs,
      finalistProb: fIdx >= 0 ? t.reach[fIdx] / runs : 0,
      semifinalProb: sfIdx >= 0 ? t.reach[sfIdx] / runs : 0,
      rounds,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/bracket-projection.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/bracket-projection.ts padelgod/src/lib/__tests__/bracket-projection.test.ts
git commit -m "feat(projection): bracket-structure-aware Monte-Carlo engine"
```

---

## Task 2: Engine — byes and the champion sanity invariant

**Files:**
- Modify: `padelgod/src/lib/__tests__/bracket-projection.test.ts`

(The engine already handles `null` slots; this task locks the behavior with tests and verifies probability coherence.)

- [ ] **Step 1: Add failing tests**

Append to `padelgod/src/lib/__tests__/bracket-projection.test.ts`:

```ts
describe('projectPairs — byes and invariants', () => {
  it('a pair with a bye reaches the next round with prob 1', () => {
    // 4 slots, slot 1 is null => A (slot 0) gets a bye into the F.
    const entrants = [pair('A', 1800), null, pair('C', 1800), pair('D', 1800)];
    const res = projectPairs({ entrants, runs: 4000, rng: mulberry32(99) });
    const aF = res.get('A')!.rounds.find(r => r.round === 'F')!;
    expect(aF.reachProb).toBeCloseTo(1, 5); // A always reaches the final
    // A has no SF opponent (bye), so its SF opponents list is empty.
    const aSF = res.get('A')!.rounds.find(r => r.round === 'SF')!;
    expect(aSF.opponents.length).toBe(0);
  });

  it('champion probabilities across all pairs sum to ~1', () => {
    const entrants = [pair('A', 1900), pair('B', 1700), pair('C', 1850), pair('D', 1750)];
    const res = projectPairs({ entrants, runs: 20000, rng: mulberry32(5) });
    const total = [...res.values()].reduce((s, p) => s + p.championProb, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it('throws on non-power-of-2 entrant counts', () => {
    expect(() => projectPairs({ entrants: [pair('A', 1800), pair('B', 1800), pair('C', 1800)], runs: 10 }))
      .toThrow(/power of 2/);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd padelgod && npx vitest run src/lib/__tests__/bracket-projection.test.ts`
Expected: PASS (5 tests total). If the bye test fails because reach for a bye round isn't recorded, confirm the engine records `reach` at the *start* of each round for all alive entrants (it does) — a bye advances `a ?? b` so the survivor is alive next round.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/lib/__tests__/bracket-projection.test.ts
git commit -m "test(projection): byes + champion-sum invariant"
```

---

## Task 3: `tournament_projections` migration

**Files:**
- Create: `supabase/migrations/20260606120000_tournament_projections.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260606120000_tournament_projections.sql`:

```sql
-- supabase/migrations/20260606120000_tournament_projections.sql
-- Per-pair tournament projections for the "Road to Trophy" / Projection feature.
-- Computed hourly by padelgod's tournament-projection-snapshot worker from the
-- Elo model + a bracket-structure-aware Monte-Carlo simulation.
-- Public-readable (the public Projection tab reads with the anon key, Premier
-- only); writes are service-role only. Holds ALL tiers (admin QA reads everything).

create table if not exists public.tournament_projections (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     uuid not null references public.tournaments(id) on delete cascade,
  category          text not null check (category in ('men','women')),
  pair_key          text not null,            -- "smallerId::largerId"
  pair_player_ids   uuid[] not null,          -- length 2
  tournament_level  text,                     -- denormalized for filtering/QA
  champion_prob     numeric(5,4) not null,
  finalist_prob     numeric(5,4) not null,
  semifinal_prob    numeric(5,4) not null,
  rounds            jsonb not null,           -- [{round,reach_prob,opponents:[{pair_key,player_ids,names,reach_prob,win_prob}]}]
  model_version     text not null,
  mc_runs           integer not null,
  computed_at       timestamptz not null default now(),
  unique (tournament_id, category, pair_key)
);

create index if not exists tournament_projections_tournament_idx
  on public.tournament_projections (tournament_id, category);
create index if not exists tournament_projections_level_idx
  on public.tournament_projections (tournament_level);

-- RLS: anon/authenticated may READ; writes are service-role only (bypasses RLS).
alter table public.tournament_projections enable row level security;
drop policy if exists tournament_projections_read on public.tournament_projections;
create policy tournament_projections_read
  on public.tournament_projections for select to anon, authenticated using (true);
```

- [ ] **Step 2: Apply the migration**

Per `memory/repo-migration-apply-method.md`, apply via the pg driver + `DATABASE_URL` (NOT `supabase db push` — migrations have drift). Run the project's migration-apply script/command against `DATABASE_URL`, then verify:

Run (psql or the repo's apply helper):
```bash
psql "$DATABASE_URL" -c "\d public.tournament_projections"
```
Expected: table exists with the columns above; RLS enabled.

- [ ] **Step 3: Verify RLS read works for anon**

Run:
```bash
psql "$DATABASE_URL" -c "select count(*) from public.tournament_projections;"
```
Expected: `0` (empty table, no error).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606120000_tournament_projections.sql
git commit -m "feat(projection): tournament_projections table + RLS"
```

---

## Task 4: Worker — frontier ordering helper

The worker must order each tournament's current-round competitors in bracket order. We reuse the **widget heap number** signal that `bracket-builder.ts` uses (Premier/Crionet draws carry it), falling back to `draw_position`, then a stable id sort.

**Files:**
- Create: `padelgod/src/workers/tournament-projection-snapshot.ts` (helper only this task)
- Create: `padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildFrontierEntrants,
  type FrontierMatchRow,
} from '../tournament-projection-snapshot.js';

const elo = new Map<string, number>([
  ['p1', 1900], ['p2', 1900], ['p3', 1700], ['p4', 1700],
  ['w1', 1850], ['w2', 1850],
]);

describe('buildFrontierEntrants', () => {
  it('orders by widget heap number and expands matches into competitor slots', () => {
    // SF round: 2 matches, heap numbers MD002 (slot0) and MD003 (slot1).
    const rows: FrontierMatchRow[] = [
      { widget_id_composite: 'X:MD003', draw_position: null, id: 'm3',
        winner_pair: null, status: 'scheduled',
        pair1_player1_id: 'p3', pair1_player2_id: 'p4',
        pair2_player1_id: 'w1', pair2_player2_id: 'w2',
        pair1_seed: null, pair2_seed: null },
      { widget_id_composite: 'X:MD002', draw_position: null, id: 'm2',
        winner_pair: null, status: 'scheduled',
        pair1_player1_id: 'p1', pair1_player2_id: 'p2',
        pair2_player1_id: 'p3', pair2_player2_id: 'p4',
        pair1_seed: 1, pair2_seed: null },
    ];
    const entrants = buildFrontierEntrants(rows, 'SF', elo, new Map());
    // MD002 first → its pair1 (p1/p2) at slot 0, pair2 (p3/p4) at slot 1;
    // MD003 → slots 2,3.
    expect(entrants.map(e => e?.pairKey)).toEqual([
      'p1::p2', 'p3::p4', 'p3::p4', 'w1::w2',
    ].map(k => k)); // ids already sorted lexically here
    expect(entrants[0]!.teamElo).toBe(1900);
  });

  it('represents a finished frontier match as [winner, null] (bye-advance)', () => {
    const rows: FrontierMatchRow[] = [
      { widget_id_composite: 'X:MD002', draw_position: null, id: 'm2',
        winner_pair: 1, status: 'finished',
        pair1_player1_id: 'p1', pair1_player2_id: 'p2',
        pair2_player1_id: 'p3', pair2_player2_id: 'p4',
        pair1_seed: 1, pair2_seed: null },
    ];
    const entrants = buildFrontierEntrants(rows, 'F', elo, new Map());
    expect(entrants[0]!.pairKey).toBe('p1::p2');
    expect(entrants[1]).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/workers/__tests__/tournament-projection-snapshot.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write the helper**

Create `padelgod/src/workers/tournament-projection-snapshot.ts` with the helper and shared types (the worker entrypoint is added in Task 5):

```ts
// tournament-projection-snapshot — hourly worker computing per-pair tournament
// projections for the Road to Trophy / Projection feature.
// See docs/superpowers/specs/2026-06-06-road-to-trophy-projection-design.md.

import { fipPriorElo } from '../lib/elo-model.js';
import {
  type FrontierEntrant,
  type ProjRound,
} from '../lib/bracket-projection.js';

export interface FrontierMatchRow {
  id: string;
  widget_id_composite: string | null;
  draw_position: number | null;
  status: string | null;
  winner_pair: number | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  pair1_seed: number | null;
  pair2_seed: number | null;
}

export interface PlayerLite { id: string; name: string | null; ranking: number | null }

/** Order-independent pair key, mirrors bracket-builder.pairKeyFor. */
export function pairKeyFor(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function widgetHeapNumber(w: string | null): number | null {
  if (!w) return null;
  const hit = /[MW]D(\d+)$/.exec(w);
  if (!hit) return null;
  const n = parseInt(hit[1], 10);
  return Number.isFinite(n) ? n : null;
}

function teamElo(
  a: string, b: string,
  elo: Map<string, number>,
  players: Map<string, PlayerLite>,
): number {
  const ea = elo.get(a) ?? fipPriorElo(players.get(a)?.ranking ?? null);
  const eb = elo.get(b) ?? fipPriorElo(players.get(b)?.ranking ?? null);
  return (ea + eb) / 2;
}

/**
 * Build the bracket-ordered frontier entrant array for one round.
 * - Orders matches by widget heap number (Premier/Crionet draws), then
 *   draw_position, then id — same stable signal as bracket-builder.
 * - Each unfinished match expands to its two competitor pairs [pair1, pair2].
 * - Each FINISHED match expands to [winnerPair, null] so the engine advances
 *   the winner unopposed (bye), respecting results without re-simulating them.
 * - Pads to the next power of two with nulls.
 */
export function buildFrontierEntrants(
  rows: FrontierMatchRow[],
  _frontierRound: ProjRound,
  elo: Map<string, number>,
  players: Map<string, PlayerLite>,
): (FrontierEntrant | null)[] {
  const ordered = [...rows].sort((a, b) => {
    const ha = widgetHeapNumber(a.widget_id_composite);
    const hb = widgetHeapNumber(b.widget_id_composite);
    if (ha != null && hb != null && ha !== hb) return ha - hb;
    if (ha != null && hb == null) return -1;
    if (ha == null && hb != null) return 1;
    const da = a.draw_position, db = b.draw_position;
    if (typeof da === 'number' && typeof db === 'number' && da !== db) return da - db;
    if (typeof da === 'number') return -1;
    if (typeof db === 'number') return 1;
    return a.id.localeCompare(b.id);
  });

  const slots: (FrontierEntrant | null)[] = [];
  const mkEntrant = (p1: string, p2: string): FrontierEntrant => ({
    pairKey: pairKeyFor(p1, p2),
    playerIds: (p1 < p2 ? [p1, p2] : [p2, p1]) as [string, string],
    teamElo: teamElo(p1, p2, elo, players),
  });

  for (const m of ordered) {
    const hasP1 = m.pair1_player1_id && m.pair1_player2_id;
    const hasP2 = m.pair2_player1_id && m.pair2_player2_id;
    const finished = m.status === 'finished' && (m.winner_pair === 1 || m.winner_pair === 2);
    if (finished) {
      const win = m.winner_pair === 1
        ? (hasP1 ? mkEntrant(m.pair1_player1_id!, m.pair1_player2_id!) : null)
        : (hasP2 ? mkEntrant(m.pair2_player1_id!, m.pair2_player2_id!) : null);
      slots.push(win, null);
    } else {
      slots.push(
        hasP1 ? mkEntrant(m.pair1_player1_id!, m.pair1_player2_id!) : null,
        hasP2 ? mkEntrant(m.pair2_player1_id!, m.pair2_player2_id!) : null,
      );
    }
  }

  let size = 1;
  while (size < slots.length) size *= 2;
  while (slots.length < size) slots.push(null);
  return slots;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/workers/__tests__/tournament-projection-snapshot.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/tournament-projection-snapshot.ts padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts
git commit -m "feat(projection): frontier-ordering helper"
```

---

## Task 5: Worker entrypoint — frontier selection, run, UPSERT

**Files:**
- Modify: `padelgod/src/workers/tournament-projection-snapshot.ts`
- Modify: `padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts`

- [ ] **Step 1: Write the failing test (frontier round selection)**

Append to `padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts`:

```ts
import { pickFrontierRound } from '../tournament-projection-snapshot.js';

describe('pickFrontierRound', () => {
  it('returns the earliest round that still has an unfinished assigned match', () => {
    // R16 fully finished, QF has an unfinished match -> frontier = QF.
    const byRound = new Map<ProjRound, FrontierMatchRow[]>([
      ['R16', [{ id: 'a', widget_id_composite: null, draw_position: 0, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4',
        pair1_seed: null, pair2_seed: null }]],
      ['QF', [{ id: 'b', widget_id_composite: null, draw_position: 0, status: 'scheduled', winner_pair: null,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'w1', pair2_player2_id: 'w2',
        pair1_seed: null, pair2_seed: null }]],
    ]);
    expect(pickFrontierRound(byRound)).toBe('QF');
  });

  it('returns null when every present round is fully finished', () => {
    const byRound = new Map<ProjRound, FrontierMatchRow[]>([
      ['F', [{ id: 'f', widget_id_composite: null, draw_position: 0, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4',
        pair1_seed: null, pair2_seed: null }]],
    ]);
    expect(pickFrontierRound(byRound)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/workers/__tests__/tournament-projection-snapshot.test.ts`
Expected: FAIL — `pickFrontierRound` not exported.

- [ ] **Step 3: Add `pickFrontierRound` + the worker entrypoint**

Append to `padelgod/src/workers/tournament-projection-snapshot.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  trainElo, MODEL_VERSION,
  type TrainingMatch, type PlayerSnapshot,
} from '../lib/elo-model.js';
import { projectPairs, PROJ_ROUND_ORDER } from '../lib/bracket-projection.js';
import { paginatedSelect } from '../lib/db-paginate.js';

const HALFLIFE_DAYS = 180;
const MC_RUNS = 20_000;

function canonRound(r: string | null | undefined): ProjRound | null {
  if (!r) return null;
  const x = r.toLowerCase();
  if (x.includes('round of 64') || x === 'r64') return 'R64';
  if (x.includes('round of 32') || x === 'r32') return 'R32';
  if (x.includes('round of 16') || x === 'r16') return 'R16';
  if (x === 'qf' || x.includes('quarter')) return 'QF';
  if (x === 'sf' || x.includes('semi')) return 'SF';
  if (x === 'f' || x.includes('final')) return 'F';
  return null;
}

function roundHasAssigned(m: FrontierMatchRow): boolean {
  return Boolean(
    (m.pair1_player1_id && m.pair1_player2_id) ||
    (m.pair2_player1_id && m.pair2_player2_id),
  );
}

/** Earliest (shallowest) main-draw round that still has an unfinished,
 *  player-assigned match. Null when the draw is fully decided / empty. */
export function pickFrontierRound(
  byRound: Map<ProjRound, FrontierMatchRow[]>,
): ProjRound | null {
  for (const r of PROJ_ROUND_ORDER) {
    const ms = (byRound.get(r) ?? []).filter(roundHasAssigned);
    if (ms.length === 0) continue;
    const anyUnfinished = ms.some(
      (m) => !(m.status === 'finished' && (m.winner_pair === 1 || m.winner_pair === 2)),
    );
    if (anyUnfinished) return r;
  }
  return null;
}

export interface TournamentProjectionDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  dryRun?: boolean;
  now?: () => Date;
}

export interface TournamentProjectionResult {
  processed: number;
  failed: number;
  rowsWritten: number;
  trainingSize: number;
  durationMs: number;
}

interface ScopeRow { id: string; level: string | null; starts_at: string | null }

export async function runTournamentProjectionSnapshot(
  deps: TournamentProjectionDeps,
): Promise<TournamentProjectionResult> {
  const { supabase, logger, dryRun = false, now = () => new Date() } = deps;
  const startMs = Date.now();
  const nowIso = now().toISOString();

  const playerRows = await paginatedSelect<PlayerSnapshot>(
    (s, e) => supabase.from('players').select('id, name, ranking, category').range(s, e),
    { what: 'players (tournament-projection-snapshot)' },
  );
  const players = new Map(playerRows.map((p) => [p.id, p]));

  const tournamentRows = await paginatedSelect<{ id: string; level: string | null }>(
    (s, e) => supabase.from('tournaments').select('id, level').range(s, e),
    { what: 'tournaments levels (tournament-projection-snapshot)' },
  );
  const tournamentLevels = new Map(tournamentRows.map((t) => [t.id, t.level ?? '']));

  // In-window tournaments, ALL tiers (admin QA needs lower tiers; the public
  // app filters to Premier via tournament_level at read time).
  const { data: scopeData } = await supabase
    .from('tournaments')
    .select('id, level, starts_at, ends_at')
    .gte('ends_at', nowIso)
    .order('starts_at', { ascending: true });
  const inScope = ((scopeData ?? []) as ScopeRow[]).filter((t) => t.starts_at);

  const training = await paginatedSelect<TrainingMatch>(
    (s, e) => supabase.from('matches').select(
      'id, tournament_id, finished_at, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, winner_pair',
    ).eq('status', 'finished').not('winner_pair', 'is', null)
      .order('scheduled_at', { ascending: true }).range(s, e),
    { what: 'training matches (tournament-projection-snapshot)' },
  );

  const trainCache = new Map<string, ReturnType<typeof trainElo>>();
  let processed = 0, failed = 0, rowsWritten = 0;

  for (const t of inScope) {
    try {
      let train = trainCache.get(t.starts_at!);
      if (!train) {
        const before = training.filter((m) => (m.scheduled_at ?? '') < t.starts_at!);
        train = trainElo(before, players, tournamentLevels, t.starts_at!, HALFLIFE_DAYS);
        trainCache.set(t.starts_at!, train);
      }

      for (const category of ['men', 'women'] as const) {
        const { data: matchData } = await supabase
          .from('matches')
          .select('id, round, round_canonical, widget_id_composite, draw_position, status, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed')
          .eq('tournament_id', t.id).eq('category', category);
        const rows = (matchData ?? []) as Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>;
        if (rows.length === 0) continue;

        const byRound = new Map<ProjRound, FrontierMatchRow[]>();
        for (const m of rows) {
          const r = canonRound(m.round_canonical ?? m.round);
          if (!r) continue;
          (byRound.get(r) ?? byRound.set(r, []).get(r)!).push(m);
        }
        const frontier = pickFrontierRound(byRound);
        if (!frontier) continue;

        const entrants = buildFrontierEntrants(byRound.get(frontier)!, frontier, train.elo, players);
        const aliveCount = entrants.filter(Boolean).length;
        if (aliveCount < 2) continue;

        const projections = projectPairs({ entrants, runs: MC_RUNS });

        const nameOf = (id: string) => players.get(id)?.name ?? '';
        const upsertRows = [...projections.values()].map((p) => ({
          tournament_id: t.id,
          category,
          pair_key: p.pairKey,
          pair_player_ids: p.playerIds,
          tournament_level: t.level,
          champion_prob: p.championProb.toFixed(4),
          finalist_prob: p.finalistProb.toFixed(4),
          semifinal_prob: p.semifinalProb.toFixed(4),
          rounds: p.rounds.map((r) => ({
            round: r.round,
            reach_prob: Number(r.reachProb.toFixed(4)),
            opponents: r.opponents.map((o) => ({
              pair_key: o.pairKey,
              player_ids: o.playerIds,
              names: o.playerIds.map(nameOf),
              reach_prob: Number(o.reachProb.toFixed(4)),
              win_prob: Number(o.winProb.toFixed(4)),
            })),
          })),
          model_version: MODEL_VERSION,
          mc_runs: MC_RUNS,
          computed_at: nowIso,
        }));

        if (!dryRun && upsertRows.length > 0) {
          // Replace this tournament+category's rows atomically (prunes pairs
          // that are no longer in the draw).
          await supabase.from('tournament_projections')
            .delete().eq('tournament_id', t.id).eq('category', category);
          const { error } = await supabase.from('tournament_projections').insert(upsertRows);
          if (error) throw error;
        }
        rowsWritten += upsertRows.length;
      }
      processed++;
    } catch (err) {
      failed++;
      logger?.error({ err, tournamentId: t.id }, 'tournament projection failed');
    }
  }

  const durationMs = Date.now() - startMs;
  logger?.info({ processed, failed, rowsWritten, trainingSize: training.length, durationMs, dryRun },
    'tournament-projection-snapshot complete');
  return { processed, failed, rowsWritten, trainingSize: training.length, durationMs };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd padelgod && npx vitest run src/workers/__tests__/tournament-projection-snapshot.test.ts`
Expected: PASS (4 tests). Run the full padelgod suite to confirm no regressions: `cd padelgod && npx vitest run`.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/tournament-projection-snapshot.ts padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts
git commit -m "feat(projection): tournament-projection-snapshot worker entrypoint"
```

---

## Task 6: Scheduler + env wiring (flag, cron, admin trigger)

**Files:**
- Modify: `padelgod/src/lib/env.ts` (near line 200)
- Modify: `padelgod/src/index.ts` (near line 175)
- Modify: `padelgod/src/scheduler.ts` (flags interface ~line 109; import ~line 33; admin-trigger case ~line 341; cron block ~line 748)

- [ ] **Step 1: Add env vars**

In `padelgod/src/lib/env.ts`, beside `ENABLE_MODEL_PREDICTION_SNAPSHOT: boolEnv(false),` add:

```ts
  ENABLE_TOURNAMENT_PROJECTION_SNAPSHOT: boolEnv(false),
  TOURNAMENT_PROJECTION_SNAPSHOT_DRY_RUN: boolEnv(false),
```

- [ ] **Step 2: Wire env → flags in index.ts**

In `padelgod/src/index.ts`, beside `enableModelPredictionSnapshot: env.ENABLE_MODEL_PREDICTION_SNAPSHOT,` add:

```ts
      enableTournamentProjectionSnapshot: env.ENABLE_TOURNAMENT_PROJECTION_SNAPSHOT,
      tournamentProjectionSnapshotDryRun: env.TOURNAMENT_PROJECTION_SNAPSHOT_DRY_RUN,
```

- [ ] **Step 3: Extend the flags interface + import in scheduler.ts**

Add the import near the other worker imports (~line 33):

```ts
import { runTournamentProjectionSnapshot } from './workers/tournament-projection-snapshot.js';
```

In the `SchedulerFlags` interface (beside `enableModelPredictionSnapshot: boolean;`), add:

```ts
  enableTournamentProjectionSnapshot: boolean;
  tournamentProjectionSnapshotDryRun: boolean;
```

Add to the worker-name union (near `| 'model-prediction-snapshot'`) and the names array (near `'model-prediction-snapshot',`):

```ts
  | 'tournament-projection-snapshot'
```
```ts
  'tournament-projection-snapshot',
```

- [ ] **Step 4: Add the admin-trigger case + cron entry**

In the worker-factory switch (beside the `'model-prediction-snapshot'` case ~line 341):

```ts
    case 'tournament-projection-snapshot': return (deps) => runTournamentProjectionSnapshot({
      supabase: deps.supabase,
      logger: deps.logger,
      // Admin-trigger always dry-run-safe; scheduled cron threads the real flag.
      dryRun: true,
    });
```

In `buildSchedule` (beside the `enableModelPredictionSnapshot` cron block ~line 748):

```ts
  if (flags.enableTournamentProjectionSnapshot) {
    entries.push({
      name: 'tournament-projection-snapshot',
      cron: '35 * * * *', // hourly at :35, offset from model-prediction-snapshot (:25)
      run: async (d) =>
        runTournamentProjectionSnapshot({
          supabase: d.supabase,
          logger: d.logger,
          dryRun: flags.tournamentProjectionSnapshotDryRun,
        }),
    });
  }
```

- [ ] **Step 5: Typecheck + scheduler tests**

Run: `cd padelgod && npx tsc --noEmit && npx vitest run src/__tests__/scheduler.test.ts`
Expected: typecheck clean; scheduler tests PASS. If `scheduler.test.ts` asserts the full worker-name list, add `'tournament-projection-snapshot'` to that expectation.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/lib/env.ts padelgod/src/index.ts padelgod/src/scheduler.ts
git commit -m "feat(projection): schedule tournament-projection-snapshot (flag, default off)"
```

---

## Task 7: Run the worker against real data + admin QA surface

This task proves the pipeline end-to-end and gives operators the all-tiers QA view the spec requires.

**Files:**
- Create: `apps/ops/src/lib/projection-data.ts`
- Create: `apps/ops/src/app/(app)/odds/projections/page.tsx`

- [ ] **Step 1: Populate the table once (real run)**

With the worker flag enabled for a one-off run (set `ENABLE_TOURNAMENT_PROJECTION_SNAPSHOT=true` and `TOURNAMENT_PROJECTION_SNAPSHOT_DRY_RUN=false` in the padelgod env, or trigger via the admin worker-trigger with dry-run off if available), run the worker once. Then verify:

```bash
psql "$DATABASE_URL" -c "select tournament_id, category, count(*) pairs, max(champion_prob) top from public.tournament_projections group by 1,2 order by 3 desc limit 10;"
```
Expected: rows for in-window tournaments; `top` champion prob between ~0.1 and ~0.6 for a clear favorite. Sanity-check one row's `rounds` JSONB has `opponents` arrays.

- [ ] **Step 2: Write the admin read helper**

Create `apps/ops/src/lib/projection-data.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!, // admin: all tiers
);

export interface ProjectionRoundOpponent {
  pair_key: string; player_ids: string[]; names: string[];
  reach_prob: number; win_prob: number;
}
export interface ProjectionRound {
  round: string; reach_prob: number; opponents: ProjectionRoundOpponent[];
}
export interface ProjectionRow {
  tournament_id: string; category: 'men' | 'women';
  pair_key: string; pair_player_ids: string[]; tournament_level: string | null;
  champion_prob: number; finalist_prob: number; semifinal_prob: number;
  rounds: ProjectionRound[]; computed_at: string;
}

export async function getProjectionTournaments(): Promise<Array<{
  tournament_id: string; name: string; level: string | null; category: string; pairs: number;
}>> {
  const { data: projRows } = await supabase
    .from('tournament_projections')
    .select('tournament_id, category, tournament_level');
  const counts = new Map<string, { tournament_id: string; level: string | null; category: string; pairs: number }>();
  for (const r of projRows ?? []) {
    const key = `${r.tournament_id}:${r.category}`;
    const c = counts.get(key) ?? { tournament_id: r.tournament_id, level: r.tournament_level, category: r.category, pairs: 0 };
    c.pairs++; counts.set(key, c);
  }
  const ids = [...new Set([...counts.values()].map((c) => c.tournament_id))];
  const { data: ts } = await supabase.from('tournaments').select('id, name').in('id', ids);
  const names = new Map((ts ?? []).map((t) => [t.id, t.name as string]));
  return [...counts.values()].map((c) => ({
    tournament_id: c.tournament_id, name: names.get(c.tournament_id) ?? c.tournament_id,
    level: c.level, category: c.category, pairs: c.pairs,
  }));
}

export async function getProjectionRows(
  tournamentId: string, category: string,
): Promise<ProjectionRow[]> {
  const { data } = await supabase
    .from('tournament_projections')
    .select('*')
    .eq('tournament_id', tournamentId).eq('category', category)
    .order('champion_prob', { ascending: false });
  return (data ?? []) as ProjectionRow[];
}
```

- [ ] **Step 3: Write the admin QA page**

Create `apps/ops/src/app/(app)/odds/projections/page.tsx` (server component; renders all tiers, a tournament list + a per-pair table with champion % and the projected road). Uses the ops `ui-page`/`DataTable` conventions:

```tsx
import { getProjectionTournaments, getProjectionRows } from '@/lib/projection-data';

export const dynamic = 'force-dynamic';

export default async function ProjectionsQAPage({
  searchParams,
}: { searchParams: Promise<{ t?: string; c?: string }> }) {
  const sp = await searchParams;
  const tournaments = await getProjectionTournaments();
  const selT = sp.t ?? tournaments[0]?.tournament_id;
  const selC = sp.c ?? tournaments.find((x) => x.tournament_id === selT)?.category ?? 'men';
  const rows = selT ? await getProjectionRows(selT, selC) : [];

  return (
    <div className="ui-page">
      <h1>Projection QA (all tiers)</h1>
      <p>Per-pair champion odds + projected road. Premier ships publicly; lower tiers are QA-only.</p>

      <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0 }}>
        {tournaments.map((t) => (
          <li key={`${t.tournament_id}:${t.category}`}>
            <a href={`?t=${t.tournament_id}&c=${t.category}`}
               style={{ fontWeight: t.tournament_id === selT && t.category === selC ? 700 : 400 }}>
              {t.name} · {t.category} · {t.level ?? '—'} ({t.pairs})
            </a>
          </li>
        ))}
      </ul>

      <table>
        <thead>
          <tr><th>Pair</th><th>Champ%</th><th>Final%</th><th>SF%</th><th>Projected road</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pair_key}>
              <td>{r.pair_player_ids.join(' / ')}</td>
              <td>{(r.champion_prob * 100).toFixed(1)}%</td>
              <td>{(r.finalist_prob * 100).toFixed(1)}%</td>
              <td>{(r.semifinal_prob * 100).toFixed(1)}%</td>
              <td>
                {r.rounds.map((rd) => {
                  const top = rd.opponents[0];
                  return (
                    <div key={rd.round}>
                      <b>{rd.round}</b> (reach {(rd.reach_prob * 100).toFixed(0)}%)
                      {top ? ` vs ${top.names.join('/')} — face ${(top.reach_prob * 100).toFixed(0)}%, win ${(top.win_prob * 100).toFixed(0)}% (+${rd.opponents.length - 1} more)` : ' — bye/unknown'}
                    </div>
                  );
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Verify in the running admin app**

Per `memory/feedback_test-locally.md`, verify in the running app. Start the ops app and open `/odds/projections`:

Run: `cd apps/ops && npm run dev` (note the port it prints), then load `http://localhost:<port>/odds/projections`.
Expected: the tournament list renders; selecting a Premier tournament shows a table of pairs sorted by champion %, each with a readable projected road (R-by-R opponent + face%/win%). Confirm a clear favorite has the highest champion %, and that a lower-tier tournament also renders (QA goal).

- [ ] **Step 5: Add the page to the ops Rail (optional but recommended)**

If `apps/ops/src/components/shell/Rail.tsx` nests Live-Odds sub-items, add a "Projections" sub-item linking to `/odds/projections`. Quote the existing sub-item markup and mirror it. Verify the link appears and navigates.

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/lib/projection-data.ts "apps/ops/src/app/(app)/odds/projections/page.tsx" apps/ops/src/components/shell/Rail.tsx
git commit -m "feat(projection): admin QA surface for tournament projections (all tiers)"
```

---

## Self-review (completed during authoring)

**Spec coverage (Plan A portion):**
- Shared MC engine reusing `pairWinProbability` → Task 1–2. ✓ (engine lives in padelgod; the public app reads the table — refinement vs the spec's "byte-identical mirror": no engine mirror is needed because projections are precomputed, only the row shape/types are shared, defined in Plan B's read helper).
- `tournament_projections` table, public-read RLS, all tiers, denormalized level → Task 3. ✓
- Hourly worker, Elo training reuse, frontier ordering, results respected, idempotent (delete+insert) → Tasks 4–5. ✓
- Flag default OFF, scheduler/env wiring → Task 6. ✓
- Admin mirror across all tiers near `/odds` → Task 7. ✓
- Bracket-structure-aware (vs the existing reshuffle MC) → Task 1 design note. ✓
- Edge cases — byes (Task 2), finished frontier matches via bye-advance (Task 4), fully-decided draw → null frontier (Task 5), missing Elo → `fipPriorElo` cold-start (Task 4 helper). ✓

**Deferred to Plan B (public UI):** Projection tab (2nd), pair picker, the visual road + drill-down, player-profile card, locked+waitlist empty state, `?tab=projection&pair=…` deep-link, public-app types for the `rounds` JSONB shape, `NEXT_PUBLIC_PROJECTION_ENABLED`.

**Not in scope (per spec non-goals):** calibration/scoring of projections; live in-play movement; following rail; match-detail link.

**Placeholder scan:** none — every code/step is concrete.

**Type consistency:** `pairKeyFor`, `FrontierEntrant`, `ProjRound`, `PROJ_ROUND_ORDER`, `projectPairs`, `buildFrontierEntrants`, `pickFrontierRound`, `runTournamentProjectionSnapshot` are used consistently across tasks; row field names (`champion_prob`, `rounds`, `reach_prob`, `win_prob`, `pair_key`) match the migration and the admin read helper.

---

## Known v1 limitations (surface during admin QA)

- **Frontier ordering** is best when matches carry widget heap codes (Premier/Crionet). For draws lacking them, ordering falls back to `draw_position`/id and may misplace a competitor — the admin QA page is how we catch this on lower tiers before any public exposure.
- **Already-finished matches inside the live frontier round** are advanced as byes (winner only); this is exact, not approximate. Earlier rounds are excluded by frontier selection.
- **Projections are uncalibrated** (per spec) — copy frames them as model estimates; a scoring job is future work.
