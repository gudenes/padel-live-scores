# Real-Time Live Odds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a live match's win probability move with the score in real time inside the existing Elo `/odds` admin — anchoring to the Elo model and animating it with an analytic in-play engine, for **every live match with point-by-point** (any tier/draw).

**Architecture:** A new lightweight padelgod worker (`live-odds-updater`, ~20s) reads the latest Elo anchor (`model_predictions`, or cold-start Elo from FIP rank for out-of-scope matches) + the live score, runs a pure in-play engine (`computeLiveProb`), and upserts `match_live_odds` (+ snapshots). A new client "Live now" section on the existing `/odds` page subscribes to `match_live_odds` via Supabase Realtime. The heavy hourly Elo snapshot/Monte-Carlo and the existing `/odds` pages are unchanged.

**Tech Stack:** TypeScript, Vitest (`cd padelgod && npx vitest run` and `cd apps/ops && npx vitest run`), Supabase Postgres + Realtime, node-cron (padelgod), Next.js server + client components (apps/ops).

**Spec:** `docs/superpowers/specs/2026-05-31-realtime-live-odds-design.md` (authoritative). Builds on the existing `2026-05-27-elo-odds-model-design.md` + `2026-05-27-odds-admin-visibility-design.md`.

---

## EXECUTION CONTEXT (read first)

- **Branch:** create a fresh branch off **current `origin/main`** (it has `padelgod/src/lib/elo-model.ts`, the `model_predictions` table, the `/odds` admin pages, `LiveOddsTable.tsx`, `odds-data.ts`). Do **not** build on the old `claude/vibrant-wilson-56f223` worktree (it predates all of that).
  ```bash
  git fetch origin
  git worktree add ../live-odds-rt -b feat/realtime-live-odds origin/main   # or checkout -b in a clean worktree
  cd ../live-odds-rt && (cd padelgod && npm install) && (cd apps/ops && npm install)
  ```
- **Reuse, don't depend on the old branch:** the in-play math below is the complete, ported source (no import from the old branch).
- padelgod uses `moduleResolution: NodeNext` → relative imports in `.ts` need `.js` extensions. Tests `import { describe,it,expect } from 'vitest'`.
- Commit after each task.

---

## File structure

```
padelgod/src/lib/inplay-odds.ts               # CREATE: ScoreState + analytic engine + computeLiveProb (pure)
padelgod/src/lib/__tests__/inplay-odds.test.ts
padelgod/src/lib/live-score-state.ts          # CREATE: DB rows → ScoreState (pure)
padelgod/src/lib/__tests__/live-score-state.test.ts
supabase/migrations/20260531120000_match_live_odds.sql   # CREATE: live tables + realtime
padelgod/src/workers/live-odds-updater.ts     # CREATE: the ~20s worker
padelgod/src/scheduler.ts                      # MODIFY: register worker (+ env flag, index wiring)
padelgod/src/lib/env.ts                        # MODIFY: ENABLE_LIVE_ODDS_UPDATER
padelgod/src/index.ts                          # MODIFY: thread the flag
apps/ops/src/components/Odds/LiveNowSection.tsx # CREATE: client Realtime "Live now" section
apps/ops/src/app/(app)/odds/page.tsx           # MODIFY: mount <LiveNowSection/> above the existing table
CLAUDE.md                                       # MODIFY: document the real-time layer
```

---

# PHASE 1 — In-play engine (pure, TDD)

## Task 1: `inplay-odds.ts` — analytic scoring engine

**Files:**
- Create: `padelgod/src/lib/inplay-odds.ts`
- Test: `padelgod/src/lib/__tests__/inplay-odds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/lib/__tests__/inplay-odds.test.ts
import { describe, it, expect } from 'vitest'
import { pWinGame, pWinTiebreak, pWinMatchFav, anchorPerPoint, type ScoreState } from '../inplay-odds.js'

const zero: ScoreState = {
  setsWon: [0, 0], gamesInSet: [0, 0], currentGamePoints: [0, 0],
  inTiebreak: false, tiebreakPoints: [0, 0], goldenPoint: true,
}

describe('pWinGame', () => {
  it('0.5 at love-all when p=0.5 (ad scoring)', () => {
    expect(pWinGame(0.5, 0, 0, false)).toBeCloseTo(0.5, 6)
  })
  it('deuce closed form p^2/(p^2+q^2)', () => {
    const p = 0.6, q = 0.4
    expect(pWinGame(p, 3, 3, false)).toBeCloseTo((p * p) / (p * p + q * q), 9)
  })
  it('golden point: 40-40 decided by one point = p', () => {
    expect(pWinGame(0.6, 3, 3, true)).toBeCloseTo(0.6, 9)
  })
  it('terminals', () => {
    expect(pWinGame(0.6, 4, 2, false)).toBe(1)
    expect(pWinGame(0.6, 2, 4, false)).toBe(0)
  })
})

describe('pWinTiebreak', () => {
  it('0.5 at 0-0 when p=0.5', () => { expect(pWinTiebreak(0.5, 0, 0)).toBeCloseTo(0.5, 6) })
  it('7-5 wins / 5-7 loses', () => {
    expect(pWinTiebreak(0.6, 7, 5)).toBe(1); expect(pWinTiebreak(0.6, 5, 7)).toBe(0)
  })
})

describe('pWinMatchFav', () => {
  it('0.5 at start when p=0.5', () => { expect(pWinMatchFav(0.5, zero)).toBeCloseTo(0.5, 4) })
  it('already two sets up → 1', () => { expect(pWinMatchFav(0.55, { ...zero, setsWon: [2, 0] })).toBe(1) })
  it('monotonic: leading helps', () => {
    expect(pWinMatchFav(0.55, { ...zero, gamesInSet: [5, 0] }))
      .toBeGreaterThan(pWinMatchFav(0.55, { ...zero, gamesInSet: [0, 5] }))
  })
})

describe('anchorPerPoint', () => {
  it('0-0 match prob equals the target within 1e-4', () => {
    for (const t of [0.55, 0.7, 0.82]) {
      const p = anchorPerPoint(t, true)
      expect(pWinMatchFav(p, zero)).toBeCloseTo(t, 4)
    }
  })
})
```

- [ ] **Step 2: Run it (red)** — `cd padelgod && npx vitest run "src/lib/__tests__/inplay-odds.test.ts"` → FAIL.

- [ ] **Step 3: Implement `inplay-odds.ts`** (note the memoized set recursion — without it `anchorPerPoint` is exponential and times out)

```ts
// padelgod/src/lib/inplay-odds.ts
// Analytic, serve-neutral padel-scoring win-probability + anchoring.
// Pure (no I/O). Moves a pre-match "anchor" probability with the live score.

export interface ScoreState {
  setsWon: [number, number]            // completed sets [pair1, pair2]
  gamesInSet: [number, number]
  currentGamePoints: [number, number]  // 0,1,2,3(=40),4(=AD)
  inTiebreak: boolean
  tiebreakPoints: [number, number]
  goldenPoint: boolean                 // no-ad rule
}

function deuceWin(p: number): number {
  const q = 1 - p
  return (p * p) / (p * p + q * q)
}

export function pWinGame(p: number, a: number, b: number, goldenPoint: boolean): number {
  const q = 1 - p, d = deuceWin(p)
  function rec(a: number, b: number): number {
    if (goldenPoint) {
      if (a >= 4) return 1
      if (b >= 4) return 0
      if (a === 3 && b === 3) return p
      return p * rec(a + 1, b) + q * rec(a, b + 1)
    }
    if (a >= 4 && a - b >= 2) return 1
    if (b >= 4 && b - a >= 2) return 0
    if (a >= 3 && b >= 3) {
      if (a === b) return d
      if (a === b + 1) return p + q * d
      if (b === a + 1) return p * d
    }
    return p * rec(a + 1, b) + q * rec(a, b + 1)
  }
  return rec(a, b)
}

export function pWinTiebreak(p: number, a: number, b: number): number {
  const q = 1 - p, d = deuceWin(p)
  function rec(a: number, b: number): number {
    if (a >= 7 && a - b >= 2) return 1
    if (b >= 7 && b - a >= 2) return 0
    if (a >= 6 && b >= 6) {
      if (a === b) return d
      if (a === b + 1) return p + q * d
      if (b === a + 1) return p * d
    }
    return p * rec(a + 1, b) + q * rec(a, b + 1)
  }
  return rec(a, b)
}

export function pWinSetFromGames(p: number, ga: number, gb: number, goldenPoint: boolean): number {
  const G = pWinGame(p, 0, 0, goldenPoint)
  const memo = new Map<number, number>()
  function rec(ga: number, gb: number): number {
    if (ga >= 6 && ga - gb >= 2) return 1
    if (gb >= 6 && gb - ga >= 2) return 0
    if (ga === 6 && gb === 6) return pWinTiebreak(p, 0, 0)
    const key = ga * 100 + gb
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    const v = G * rec(ga + 1, gb) + (1 - G) * rec(ga, gb + 1)
    memo.set(key, v)
    return v
  }
  return rec(ga, gb)
}

export function pWinMatchFromSets(p: number, sa: number, sb: number, goldenPoint: boolean): number {
  const S = pWinSetFromGames(p, 0, 0, goldenPoint)
  function rec(sa: number, sb: number): number {
    if (sa >= 2) return 1
    if (sb >= 2) return 0
    return S * rec(sa + 1, sb) + (1 - S) * rec(sa, sb + 1)
  }
  return rec(sa, sb)
}

function pCurrentSetWin(p: number, s: ScoreState): number {
  const [ga, gb] = s.gamesInSet
  if (s.inTiebreak) return pWinTiebreak(p, s.tiebreakPoints[0], s.tiebreakPoints[1])
  const gNow = pWinGame(p, s.currentGamePoints[0], s.currentGamePoints[1], s.goldenPoint)
  return gNow * pWinSetFromGames(p, ga + 1, gb, s.goldenPoint)
    + (1 - gNow) * pWinSetFromGames(p, ga, gb + 1, s.goldenPoint)
}

/** Match-win prob for the FAVORITE; `s` must be oriented to the favorite. */
export function pWinMatchFav(p: number, s: ScoreState): number {
  const setNow = pCurrentSetWin(p, s)
  const [sa, sb] = s.setsWon
  return setNow * pWinMatchFromSets(p, sa + 1, sb, s.goldenPoint)
    + (1 - setNow) * pWinMatchFromSets(p, sa, sb + 1, s.goldenPoint)
}

/** Per-point p so the 0-0 match prob equals `target` (binary search). */
export function anchorPerPoint(target: number, goldenPoint: boolean): number {
  const zero: ScoreState = {
    setsWon: [0, 0], gamesInSet: [0, 0], currentGamePoints: [0, 0],
    inTiebreak: false, tiebreakPoints: [0, 0], goldenPoint,
  }
  let lo = 0.5, hi = 1 - 1e-9
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (pWinMatchFav(mid, zero) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
```

- [ ] **Step 4: Run it (green)** — `cd padelgod && npx vitest run "src/lib/__tests__/inplay-odds.test.ts"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/inplay-odds.ts padelgod/src/lib/__tests__/inplay-odds.test.ts
git commit -m "feat(odds): analytic in-play win-probability engine"
```

---

## Task 2: `computeLiveProb` (anchor → live pair1 prob)

**Files:**
- Modify: `padelgod/src/lib/inplay-odds.ts` (append)
- Modify: `padelgod/src/lib/__tests__/inplay-odds.test.ts` (append)

- [ ] **Step 1: Append the failing test**

```ts
// append to padelgod/src/lib/__tests__/inplay-odds.test.ts
import { computeLiveProb } from '../inplay-odds.js'

describe('computeLiveProb', () => {
  const zero: ScoreState = {
    setsWon: [0, 0], gamesInSet: [0, 0], currentGamePoints: [0, 0],
    inTiebreak: false, tiebreakPoints: [0, 0], goldenPoint: true,
  }
  it('at 0-0 returns the anchor (anchor identity)', () => {
    expect(computeLiveProb(0.82, zero)).toBeCloseTo(0.82, 3)
    expect(computeLiveProb(0.5, zero)).toBeCloseTo(0.5, 3)
  })
  it('orients to whichever side the anchor favors', () => {
    // pair2 favored (anchor 0.30 for pair1) AND pair2 leading → pair1 prob drops well below 0.30
    const s: ScoreState = { ...zero, setsWon: [0, 1], gamesInSet: [0, 4] }
    expect(computeLiveProb(0.30, s)).toBeLessThan(0.30)
  })
  it('a leading favorite climbs toward 1', () => {
    const s: ScoreState = { ...zero, setsWon: [1, 0], gamesInSet: [5, 0], currentGamePoints: [3, 0] }
    expect(computeLiveProb(0.70, s)).toBeGreaterThan(0.70)
  })
})
```

- [ ] **Step 2: Run it (red)** — `cd padelgod && npx vitest run "src/lib/__tests__/inplay-odds.test.ts"` → FAIL (no `computeLiveProb`).

- [ ] **Step 3: Append `computeLiveProb` to `inplay-odds.ts`**

```ts
// append to padelgod/src/lib/inplay-odds.ts
function orientToFavorite(s: ScoreState, favorite: 1 | 2): ScoreState {
  if (favorite === 1) return s
  const swap = ([a, b]: [number, number]): [number, number] => [b, a]
  return {
    setsWon: swap(s.setsWon),
    gamesInSet: swap(s.gamesInSet),
    currentGamePoints: swap(s.currentGamePoints),
    inTiebreak: s.inTiebreak,
    tiebreakPoints: swap(s.tiebreakPoints),
    goldenPoint: s.goldenPoint,
  }
}

/** Move a pre-match pair1 win probability (`anchorPair1Prob`, 0..1) with the live score. */
export function computeLiveProb(anchorPair1Prob: number, score: ScoreState): number {
  const favorite: 1 | 2 = anchorPair1Prob >= 0.5 ? 1 : 2
  const target = Math.max(anchorPair1Prob, 1 - anchorPair1Prob)
  const p = anchorPerPoint(target, score.goldenPoint)
  const favProb = pWinMatchFav(p, orientToFavorite(score, favorite))
  return favorite === 1 ? favProb : 1 - favProb
}
```

- [ ] **Step 4: Run it (green)** — `cd padelgod && npx vitest run "src/lib/__tests__/inplay-odds.test.ts"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/inplay-odds.ts padelgod/src/lib/__tests__/inplay-odds.test.ts
git commit -m "feat(odds): computeLiveProb anchors the live engine to a pre-match probability"
```

---

# PHASE 2 — Score-state extractor (pure)

## Task 3: `live-score-state.ts`

**Files:**
- Create: `padelgod/src/lib/live-score-state.ts`
- Test: `padelgod/src/lib/__tests__/live-score-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/lib/__tests__/live-score-state.test.ts
import { describe, it, expect } from 'vitest'
import { parsePadelPoints, buildScoreState, type SetRow, type GameRow } from '../live-score-state.js'

describe('parsePadelPoints', () => {
  it('maps labels to counts', () => {
    expect([parsePadelPoints('0'), parsePadelPoints('15'), parsePadelPoints('30'),
            parsePadelPoints('40'), parsePadelPoints('AD'), parsePadelPoints('A')])
      .toEqual([0, 1, 2, 3, 4, 4])
  })
})

describe('buildScoreState', () => {
  const sets: SetRow[] = [
    { pair1_games: 6, pair2_games: 3, is_current: false },
    { pair1_games: 4, pair2_games: 2, is_current: true },
  ]
  it('sets won + current games + current points (30-15)', () => {
    const s = buildScoreState(sets, { game_score: '30-15' })
    expect(s.setsWon).toEqual([1, 0])
    expect(s.gamesInSet).toEqual([4, 2])
    expect(s.currentGamePoints).toEqual([2, 1])
    expect(s.inTiebreak).toBe(false)
    expect(s.goldenPoint).toBe(true)
  })
  it('6-6 with a current game → tiebreak with raw points', () => {
    const s = buildScoreState([{ pair1_games: 6, pair2_games: 6, is_current: true }], { game_score: '5-3' })
    expect(s.inTiebreak).toBe(true)
    expect(s.tiebreakPoints).toEqual([5, 3])
  })
  it('no current game → zero points', () => {
    const s = buildScoreState([{ pair1_games: 2, pair2_games: 1, is_current: true }], null)
    expect(s.currentGamePoints).toEqual([0, 0])
  })
})
```

- [ ] **Step 2: Run it (red)** — `cd padelgod && npx vitest run "src/lib/__tests__/live-score-state.test.ts"` → FAIL.

- [ ] **Step 3: Implement `live-score-state.ts`**

```ts
// padelgod/src/lib/live-score-state.ts
import type { ScoreState } from './inplay-odds.js'

export interface SetRow { pair1_games: number; pair2_games: number; is_current: boolean }
export interface GameRow { game_score: string | null }

const GOLDEN_POINT_DEFAULT = true // Premier/FIP standard

export function parsePadelPoints(label: string): number {
  const s = label.trim().toUpperCase()
  if (s === 'AD' || s === 'A') return 4
  if (s === '40') return 3
  if (s === '30') return 2
  if (s === '15') return 1
  if (s === '0' || s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0 // tiebreak raw integers
}

function parsePair(score: string | null): [number, number] {
  if (!score) return [0, 0]
  const [a, b] = score.split('-').map((x) => x.trim())
  return [parsePadelPoints(a ?? '0'), parsePadelPoints(b ?? '0')]
}

export function buildScoreState(sets: SetRow[], currentGame: GameRow | null): ScoreState {
  const current = sets.find((s) => s.is_current) ?? sets[sets.length - 1]
  const setsWon: [number, number] = sets
    .filter((s) => s !== current)
    .reduce<[number, number]>(
      (acc, s) => [acc[0] + (s.pair1_games > s.pair2_games ? 1 : 0), acc[1] + (s.pair2_games > s.pair1_games ? 1 : 0)],
      [0, 0],
    )
  const gamesInSet: [number, number] = current ? [current.pair1_games, current.pair2_games] : [0, 0]
  const inTiebreak = gamesInSet[0] === 6 && gamesInSet[1] === 6 && currentGame != null
  const rawPts = parsePair(currentGame?.game_score ?? null)
  return {
    setsWon, gamesInSet,
    currentGamePoints: inTiebreak ? [0, 0] : rawPts,
    inTiebreak,
    tiebreakPoints: inTiebreak ? rawPts : [0, 0],
    goldenPoint: GOLDEN_POINT_DEFAULT,
  }
}
```

- [ ] **Step 4: Run it (green)** — `cd padelgod && npx vitest run "src/lib/__tests__/live-score-state.test.ts"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/live-score-state.ts padelgod/src/lib/__tests__/live-score-state.test.ts
git commit -m "feat(odds): DB rows → live ScoreState extractor"
```

---

# PHASE 3 — Migration

## Task 4: `match_live_odds` + snapshots

**Files:**
- Create: `supabase/migrations/20260531120000_match_live_odds.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260531120000_match_live_odds.sql
-- Real-time (in-play) live odds: latest per live match + append-only history.
-- Anchored to the Elo model (model_predictions) or cold-start Elo for out-of-scope matches.

create table if not exists public.match_live_odds (
  match_id             uuid primary key references public.matches(id) on delete cascade,
  pair1_prob           numeric(5,4) not null,
  pair2_prob           numeric(5,4) not null,
  pair1_decimal_odds   numeric(8,3) not null,
  pair2_decimal_odds   numeric(8,3) not null,
  anchor_source        text not null check (anchor_source in ('model-prediction','cold-start-elo')),
  anchor_prediction_id uuid references public.model_predictions(id) on delete set null,
  coverage             text not null check (coverage in ('live-pbp','live-coarse')),
  model_version        text not null default 'inplay-v1',
  computed_at          timestamptz not null default now()
);

create table if not exists public.match_live_odds_snapshots (
  id          bigint generated always as identity primary key,
  match_id    uuid not null references public.matches(id) on delete cascade,
  pair1_prob  numeric(5,4) not null,
  computed_at timestamptz not null default now()
);
create index if not exists match_live_odds_snapshots_match_time_idx
  on public.match_live_odds_snapshots (match_id, computed_at desc);

-- RLS: anon may READ (the /odds "Live now" client island subscribes with the anon key);
-- writes are service-role only (the padelgod worker), which bypasses RLS.
alter table public.match_live_odds enable row level security;
alter table public.match_live_odds_snapshots enable row level security;
drop policy if exists match_live_odds_read on public.match_live_odds;
create policy match_live_odds_read on public.match_live_odds for select to anon, authenticated using (true);
drop policy if exists match_live_odds_snapshots_read on public.match_live_odds_snapshots;
create policy match_live_odds_snapshots_read on public.match_live_odds_snapshots for select to anon, authenticated using (true);

-- Realtime publish (tolerant of FOR ALL TABLES / already-member / no-publication setups).
do $$
begin
  alter publication supabase_realtime add table public.match_live_odds;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
```

- [ ] **Step 2: Verify it parses** — apply to a local Supabase if available (`supabase db push`), else statically confirm it matches the conventions of `supabase/migrations/20260527_create_model_prediction_tables.sql` (types, FK to `model_predictions`, index syntax). Note in the commit whether it was applied locally.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260531120000_match_live_odds.sql
git commit -m "feat(odds): match_live_odds + snapshots (RLS + realtime)"
```

---

# PHASE 4 — Worker

## Task 5: `live-odds-updater` worker + scheduler registration

**Files:**
- Create: `padelgod/src/workers/live-odds-updater.ts`
- Modify: `padelgod/src/scheduler.ts`, `padelgod/src/lib/env.ts`, `padelgod/src/index.ts`

- [ ] **Step 1: Implement the worker** (reuses the existing `elo-model.ts` for the cold-start anchor + odds formatting)

```ts
// padelgod/src/workers/live-odds-updater.ts
import type { SchedulerDeps } from '../scheduler.js'
import { computeLiveProb } from '../lib/inplay-odds.js'
import { buildScoreState, type SetRow } from '../lib/live-score-state.js'
import { fipPriorElo, pairWinProbability, toDecimal } from '../lib/elo-model.js'

const LIVE = ['live', 'on_court', 'break']
const PBP_RECENCY_MS = 2 * 60 * 1000

interface MatchRow {
  id: string; status: string
  pair1_player1_id: string | null; pair1_player2_id: string | null
  pair2_player1_id: string | null; pair2_player2_id: string | null
}

export async function runLiveOddsUpdater(deps: SchedulerDeps): Promise<{
  updated: number; model: number; coldStart: number; skippedNoPbp: number; errors: number
}> {
  const { supabase, logger } = deps
  let updated = 0, model = 0, coldStart = 0, skippedNoPbp = 0, errors = 0

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id,status,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id')
    .in('status', LIVE)
    .returns<MatchRow[]>()
  if (error) { logger.error({ worker: 'live-odds-updater', error: error.message }, 'live match query failed'); return { updated, model, coldStart, skippedNoPbp, errors: 1 } }

  const cutoff = new Date(Date.now() - PBP_RECENCY_MS).toISOString()
  for (const m of matches ?? []) {
    try {
      // Point-by-point gate: must have a recent match_points row.
      const { count } = await supabase.from('match_points')
        .select('point_number', { count: 'exact', head: true })
        .eq('match_id', m.id).gte('created_at', cutoff)
      const hasPbp = (count ?? 0) > 0
      if (!hasPbp) { skippedNoPbp++; continue }

      // Anchor: latest model_predictions, else cold-start Elo from FIP rank.
      const { data: mp } = await supabase.from('model_predictions')
        .select('id,pair1_prob').eq('match_id', m.id).order('created_at', { ascending: false }).limit(1)
      let anchorPair1: number
      let anchorSource: 'model-prediction' | 'cold-start-elo'
      let anchorId: string | null = null
      if (mp && mp[0]) {
        anchorPair1 = mp[0].pair1_prob as number
        anchorSource = 'model-prediction'
        anchorId = mp[0].id as string
      } else {
        anchorPair1 = await coldStartAnchor(supabase, m)
        anchorSource = 'cold-start-elo'
      }

      // Live score.
      const { data: sets } = await supabase.from('sets')
        .select('pair1_games,pair2_games,is_current').eq('match_id', m.id).order('set_number', { ascending: true })
      const { data: games } = await supabase.from('games')
        .select('game_score,is_current').eq('match_id', m.id).eq('is_current', true).limit(1)
      const score = buildScoreState((sets ?? []) as SetRow[], games && games[0] ? { game_score: games[0].game_score as string | null } : null)

      const p1 = computeLiveProb(anchorPair1, score)
      const p2 = 1 - p1
      const coverage = games && games[0] && games[0].game_score ? 'live-pbp' : 'live-coarse'

      await supabase.from('match_live_odds').upsert({
        match_id: m.id,
        pair1_prob: p1, pair2_prob: p2,
        pair1_decimal_odds: round3(toDecimal(p1)), pair2_decimal_odds: round3(toDecimal(p2)),
        anchor_source: anchorSource, anchor_prediction_id: anchorId,
        coverage, model_version: 'inplay-v1', computed_at: new Date().toISOString(),
      }, { onConflict: 'match_id' })
      await supabase.from('match_live_odds_snapshots').insert({ match_id: m.id, pair1_prob: p1 })

      updated++
      if (anchorSource === 'model-prediction') model++; else coldStart++
    } catch (e) {
      errors++
      logger.warn({ worker: 'live-odds-updater', matchId: m.id, err: String(e) }, 'live odds update failed')
    }
  }
  logger.info({ worker: 'live-odds-updater', updated, model, coldStart, skippedNoPbp, errors }, 'live-odds-updater done')
  return { updated, model, coldStart, skippedNoPbp, errors }
}

function round3(x: number): number { return Math.round(x * 1000) / 1000 }

async function coldStartAnchor(supabase: SchedulerDeps['supabase'], m: MatchRow): Promise<number> {
  const ids = [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]
  const ranks = new Map<string, number | null>()
  const present = ids.filter((x): x is string => !!x)
  if (present.length) {
    const { data } = await supabase.from('players').select('id,ranking').in('id', present)
    for (const p of data ?? []) ranks.set(p.id as string, (p.ranking as number | null) ?? null)
  }
  const elo = (id: string | null) => fipPriorElo(id ? ranks.get(id) ?? null : null)
  const pair1Elo = (elo(m.pair1_player1_id) + elo(m.pair1_player2_id)) / 2
  const pair2Elo = (elo(m.pair2_player1_id) + elo(m.pair2_player2_id)) / 2
  return pairWinProbability(pair1Elo, pair2Elo)
}
```

- [ ] **Step 2: Register in the scheduler** — first **read `padelgod/src/scheduler.ts`, `env.ts`, `index.ts`** to match the exact current pattern (it has other workers like `model-prediction-snapshot`). Then mirror it for `live-odds-updater`:
  - `env.ts`: add `ENABLE_LIVE_ODDS_UPDATER: boolEnv(false)` (default OFF until validated).
  - `scheduler.ts`: import `runLiveOddsUpdater`; add `'live-odds-updater'` to the `WorkerName` union + the `ALL_WORKERS` array; add `enableLiveOddsUpdater: boolean` to `SchedulerFlags`; add the `getWorkerRunner` case `case 'live-odds-updater': return (deps) => runLiveOddsUpdater(deps);`; add a flag-gated `buildSchedule` entry:
    ```ts
    if (flags.enableLiveOddsUpdater) {
      entries.push({ name: 'live-odds-updater', cron: '*/20 * * * * *', run: getWorkerRunner('live-odds-updater')! });
    }
    ```
  - `index.ts`: thread `enableLiveOddsUpdater: env.ENABLE_LIVE_ODDS_UPDATER` into the `buildSchedule(...)` flags object.
  - If `scheduler.test.ts` asserts the worker/flag set, add `'live-odds-updater'` / `enableLiveOddsUpdater: true` to the expected fixtures, matching the existing style.

- [ ] **Step 3: Typecheck + scheduler test**

Run: `cd padelgod && npx tsc --noEmit && npx vitest run "src/__tests__/scheduler.test.ts"` (if present)
Expected: no NEW errors from your files; scheduler test passes (update fixtures only as above). The worker can't be runtime-verified without a DB — that's expected; verification here is `tsc` + the scheduler test.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/workers/live-odds-updater.ts padelgod/src/scheduler.ts padelgod/src/lib/env.ts padelgod/src/index.ts padelgod/src/__tests__/scheduler.test.ts
git commit -m "feat(odds): live-odds-updater worker (Elo anchor + in-play movement)"
```

---

# PHASE 5 — Frontend (extend the existing `/odds`)

## Task 6: "Live now" Realtime section on `/odds`

**Files:**
- Create: `apps/ops/src/components/Odds/LiveNowSection.tsx`
- Modify: `apps/ops/src/app/(app)/odds/page.tsx`

- [ ] **Step 1: Read the existing surfaces first** — read `apps/ops/src/app/(app)/odds/page.tsx`, `apps/ops/src/components/Odds/LiveOddsTable.tsx`, and `apps/ops/src/lib/odds-data.ts` to match styling/props and confirm the matches/players FK alias names used elsewhere.

- [ ] **Step 2: Create the client `LiveNowSection`** (self-contained; subscribes to `match_live_odds` and renders a live section)

```tsx
// apps/ops/src/components/Odds/LiveNowSection.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface LiveRow {
  match_id: string
  pair1_prob: number; pair2_prob: number
  pair1_decimal_odds: number; pair2_decimal_odds: number
  anchor_source: 'model-prediction' | 'cold-start-elo'
  coverage: 'live-pbp' | 'live-coarse'
  computed_at: string
  matches: {
    court: string | null; round: string | null
    tournament: { name: string | null } | null
    p1a: { name: string | null } | null; p1b: { name: string | null } | null
    p2a: { name: string | null } | null; p2b: { name: string | null } | null
  } | null
}

// NOTE: confirm these FK alias names against the schema (PostgREST default <table>_<column>_fkey).
const SELECT =
  'match_id,pair1_prob,pair2_prob,pair1_decimal_odds,pair2_decimal_odds,anchor_source,coverage,computed_at,' +
  'matches!inner(court,round,tournament:tournaments(name),' +
  'p1a:players!matches_pair1_player1_id_fkey(name),p1b:players!matches_pair1_player2_id_fkey(name),' +
  'p2a:players!matches_pair2_player1_id_fkey(name),p2b:players!matches_pair2_player2_id_fkey(name))'

function client(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
}
const pair = (a?: { name: string | null } | null, b?: { name: string | null } | null) =>
  [a?.name, b?.name].filter(Boolean).join(' / ') || 'TBD'

export function LiveNowSection() {
  const [rows, setRows] = useState<LiveRow[]>([])
  useEffect(() => {
    const supabase = client()
    let active = true
    const load = async () => {
      const { data } = await supabase.from('match_live_odds').select(SELECT).order('computed_at', { ascending: false }).returns<LiveRow[]>()
      if (active) setRows(data ?? [])
    }
    load()
    const ch = supabase.channel('match_live_odds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_live_odds' }, load)
      .subscribe()
    return () => { active = false; supabase.removeChannel(ch) }
  }, [])

  if (rows.length === 0) return null
  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--status-live)', margin: '0 0 8px' }}>
        ● Live now ({rows.length})
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-3, #71717a)' }}>
            <th style={{ padding: '6px 8px' }}>Match</th><th>Tournament</th>
            <th style={{ textAlign: 'right' }}>Pair 1</th><th style={{ textAlign: 'right' }}>Pair 2</th>
            <th>Anchor</th><th style={{ textAlign: 'right' }}>Upd</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = r.matches
            const ageS = Math.max(0, Math.round((Date.now() - +new Date(r.computed_at)) / 1000))
            return (
              <tr key={r.match_id} style={{ borderTop: '1px solid var(--border-subtle, #e5e7eb)', fontSize: 13 }}>
                <td style={{ padding: '8px' }}>{pair(m?.p1a, m?.p1b)} vs {pair(m?.p2a, m?.p2b)}<div style={{ fontSize: 11, color: '#71717a' }}>{m?.court} · {m?.round}</div></td>
                <td>{m?.tournament?.name ?? ''}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(r.pair1_prob * 100)}% · {r.pair1_decimal_odds.toFixed(2)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(r.pair2_prob * 100)}% · {r.pair2_decimal_odds.toFixed(2)}</td>
                <td><span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: r.anchor_source === 'model-prediction' ? '#dcfce7' : '#fef3c7' }}>{r.anchor_source === 'model-prediction' ? 'Elo' : 'cold-start'}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#71717a' }}>{ageS}s</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 3: Mount it on `/odds`** — in `apps/ops/src/app/(app)/odds/page.tsx`, import `LiveNowSection` and render `<LiveNowSection />` near the top of the page body, **above** the existing "Today's matches" table (Section A). It's a client island inside the server page — fine in Next 16. Match the page's existing container/padding.

- [ ] **Step 4: Typecheck + build**

Run: `cd apps/ops && npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds. (Runtime needs the worker to have written `match_live_odds` rows + the FK aliases confirmed — verified later against the real DB.)

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/components/Odds/LiveNowSection.tsx "apps/ops/src/app/(app)/odds/page.tsx"
git commit -m "feat(ops): live-now realtime section on /odds (in-play odds)"
```

---

## Task 7: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a short note** under the existing Odds/model documentation: the `/odds` Live Odds now has a real-time "Live now" layer — `live-odds-updater` (padelgod, ~20s, flag `enableLiveOddsUpdater`) anchors to `model_predictions` (or cold-start Elo from FIP rank for out-of-scope/qualifying matches), applies the analytic in-play engine (`padelgod/src/lib/inplay-odds.ts`), and writes `match_live_odds` (+ snapshots); the `/odds` page's `LiveNowSection` subscribes via Realtime. Point-by-point presence is the coverage gate (any tier/draw, including qualifying). Spec: `docs/superpowers/specs/2026-05-31-realtime-live-odds-design.md`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: real-time live odds layer on /odds"
```

---

## Out of scope (separate tracks)
- The `/odds` **visual redesign** (scoreboard look) — separate PR.
- Serve-split per-point probabilities (v1 serve-neutral).
- A persisted `player_elo_snapshots` table to give *trained* Elo anchors to out-of-scope matches (today they use cold-start).
- Calibration of the *live* numbers (the existing `prediction_scores` scores the pre-match Elo only).
- `match_live_odds_snapshots` retention/prune.

