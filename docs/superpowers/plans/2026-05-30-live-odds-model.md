# Live Win-Probability Model & Odds Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute real, live-moving win probabilities + fair odds for padel matches (ranking prior anchored + analytic in-play engine), store them, and feed them to the Live Odds admin console — replacing the stub.

**Architecture:** A pure model (canonical in main app `src/lib/odds/`, byte-mirrored into `padelgod/src/lib/odds/`) computes match-win probability from rankings + live score. A node-cron padelgod worker (`odds-computer`) writes `match_odds` (+ `match_odds_snapshots`) every ~15s for live matches and slower for scheduled. The `apps/ops` Live Odds console subscribes to `match_odds` via Supabase Realtime, replacing `createStubFeed` behind the existing `types.ts` contract.

**Tech Stack:** TypeScript, Vitest (main app, `npx vitest run` from repo root), Supabase Postgres + Realtime, node-cron (padelgod), Next.js (apps/ops).

**Spec:** `docs/superpowers/specs/2026-05-30-live-odds-model-design.md` (authoritative for decisions/values).

**Conventions:**
- Main-app tests: `npx vitest run "<path>"` from repo root. Test files `import { describe, it, expect } from 'vitest'` (works regardless of globals config).
- The `src/lib/odds/` module is **self-contained** (no `@/` imports, no main-app-only deps) so it mirrors byte-identically into padelgod.
- Commit after each task. All paths relative to repo root.

---

## File structure

```
src/lib/odds/                              # CANONICAL model (tested here)
  types.ts                                 # ScoreState, OddsInput, OddsResult, Confidence
  prematch.ts                              # ranking → pre-match prob (mirror of predictions formula) + fairOdds
  scoring.ts                               # analytic engine: pWinGame/Tiebreak/Set/Match + anchor
  index.ts                                 # computeOdds(input) → OddsResult (orient to favorite + confidence)
  __tests__/prematch.test.ts
  __tests__/scoring.test.ts
  __tests__/index.test.ts

padelgod/src/lib/odds/                     # BYTE-IDENTICAL MIRROR (worker consumes this)
  types.ts  prematch.ts  scoring.ts  index.ts

padelgod/src/lib/odds-state.ts             # pure: sets/games/match_points rows → ScoreState
padelgod/src/lib/__tests__/odds-state.test.ts
padelgod/src/workers/odds-computer.ts      # node-cron worker (live + pre-match passes)
padelgod/src/scheduler.ts                  # MODIFY: register odds-computer

supabase/migrations/
  <ts>_match_odds.sql                      # match_odds + match_odds_snapshots tables + RLS + realtime

apps/ops/src/app/(app)/live-odds/_lib/
  realtime-provider.ts                     # Supabase Realtime subscription → Match[] + Kpis
  useLiveOdds.ts                           # MODIFY: use realtime provider (stub kept as dev fallback)

CLAUDE.md                                  # MODIFY: document the odds model + pipeline
```

---

# PHASE 1 — The model (pure, TDD)

## Task 1: Types + pre-match prior + fair odds

**Files:**
- Create: `src/lib/odds/types.ts`
- Create: `src/lib/odds/prematch.ts`
- Test: `src/lib/odds/__tests__/prematch.test.ts`

- [ ] **Step 1: Write `types.ts`** (no test needed — type-only)

```ts
// src/lib/odds/types.ts
// Self-contained: no @/ imports (mirrors byte-identically into padelgod).
export type Confidence = 'full' | 'med' | 'pre-match' | 'thin'

/** Favorite-agnostic live score, oriented to pair1/pair2 (1=pair1, 2=pair2). */
export interface ScoreState {
  setsWon: [number, number]            // completed sets [pair1, pair2]
  gamesInSet: [number, number]         // games in the current set
  currentGamePoints: [number, number]  // point counts in current game: 0,1,2,3 (=40), 4 (=AD)
  inTiebreak: boolean
  tiebreakPoints: [number, number]
  goldenPoint: boolean                 // true = no-ad (golden point) game rule
}

export interface OddsInput {
  rankings: [number | null, number | null, number | null, number | null]
  // [pair1p1, pair1p2, pair2p1, pair2p2] FIP rankings (lower = stronger), null if unknown
  score: ScoreState | null             // null = pre-match (prior only)
  pointByPoint: boolean                // true when live point data is flowing (drives confidence)
}

export interface OddsResult {
  pair1WinProb: number                 // 0..1
  pair2WinProb: number
  pair1FairOdds: number                // 1/p, rounded 2dp
  pair2FairOdds: number
  confidence: Confidence
}
```

- [ ] **Step 2: Write the failing test for `prematch.ts`**

```ts
// src/lib/odds/__tests__/prematch.test.ts
import { describe, it, expect } from 'vitest'
import { preMatchProb, fairOdds } from '../prematch'

describe('preMatchProb', () => {
  it('returns 0.5/0.5 when any of the four rankings is missing', () => {
    expect(preMatchProb([1, 2, 3, null])).toEqual({ p1: 0.5, p2: 0.5, fallback: true })
  })

  it('favors the lower-ranked (stronger) pair and clamps to [0.20,0.80]', () => {
    const { p1, p2, fallback } = preMatchProb([1, 2, 200, 210]) // pair1 much stronger
    expect(fallback).toBe(false)
    expect(p1).toBeCloseTo(0.8, 5)   // saturates the clamp
    expect(p2).toBeCloseTo(0.2, 5)
    expect(p1 + p2).toBeCloseTo(1, 10)
  })

  it('is ~even for equal rankings', () => {
    const { p1 } = preMatchProb([50, 60, 50, 60])
    expect(p1).toBeCloseTo(0.5, 6)
  })

  it('fairOdds is 1/p rounded to 2dp', () => {
    expect(fairOdds(0.8)).toBe(1.25)
    expect(fairOdds(0.2)).toBe(5)
  })
})
```

- [ ] **Step 3: Run it (red)** — `npx vitest run "src/lib/odds/__tests__/prematch.test.ts"` → FAIL (cannot resolve `../prematch`).

- [ ] **Step 4: Implement `prematch.ts`**

```ts
// src/lib/odds/prematch.ts
// Pre-match win probability from FIP rankings.
// MIRROR of the formula/constants in src/lib/predictions/probability.ts (kept in
// sync deliberately). Self-contained so it can be byte-mirrored into padelgod.

const SCALE = 1.5
const PROB_CLAMP_MIN = 0.2
const PROB_CLAMP_MAX = 0.8

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
function avg(ranks: number[]): number {
  return ranks.reduce((a, b) => a + b, 0) / ranks.length
}

/** rankings = [pair1p1, pair1p2, pair2p1, pair2p2]; lower = stronger. */
export function preMatchProb(
  rankings: [number | null, number | null, number | null, number | null],
): { p1: number; p2: number; fallback: boolean } {
  const [a, b, c, d] = rankings
  const p1Ranks = [a, b].filter((r): r is number => typeof r === 'number' && r > 0)
  const p2Ranks = [c, d].filter((r): r is number => typeof r === 'number' && r > 0)
  if (p1Ranks.length !== 2 || p2Ranks.length !== 2) {
    return { p1: 0.5, p2: 0.5, fallback: true }
  }
  const s1 = Math.log(1 / avg(p1Ranks))
  const s2 = Math.log(1 / avg(p2Ranks))
  const p1 = clamp(sigmoid((s1 - s2) * SCALE), PROB_CLAMP_MIN, PROB_CLAMP_MAX)
  const p2 = clamp(1 - p1, PROB_CLAMP_MIN, PROB_CLAMP_MAX)
  return { p1, p2, fallback: false }
}

/** Inverse-probability fair odds, rounded to 2dp. */
export function fairOdds(prob: number): number {
  const safe = clamp(prob, 0.0001, 1)
  return Math.round((1 / safe) * 100) / 100
}
```

- [ ] **Step 5: Run it (green)** — `npx vitest run "src/lib/odds/__tests__/prematch.test.ts"` → PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/odds/types.ts src/lib/odds/prematch.ts src/lib/odds/__tests__/prematch.test.ts
git commit -m "feat(odds): types + ranking pre-match prob + fair odds"
```

---

## Task 2: Game + tiebreak win probability

**Files:**
- Create: `src/lib/odds/scoring.ts`
- Test: `src/lib/odds/__tests__/scoring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/odds/__tests__/scoring.test.ts
import { describe, it, expect } from 'vitest'
import { pWinGame, pWinTiebreak } from '../scoring'

describe('pWinGame (ad scoring)', () => {
  it('is 0.5 at love-all when p=0.5', () => {
    expect(pWinGame(0.5, 0, 0, false)).toBeCloseTo(0.5, 6)
  })
  it('returns 1 when already won, 0 when already lost', () => {
    expect(pWinGame(0.6, 4, 2, false)).toBe(1)
    expect(pWinGame(0.6, 2, 4, false)).toBe(0)
  })
  it('deuce closed form: P(win from 40-40) = p^2/(p^2+q^2)', () => {
    const p = 0.6, q = 0.4
    expect(pWinGame(p, 3, 3, false)).toBeCloseTo((p * p) / (p * p + q * q), 9)
  })
  it('rises monotonically with p at love-all', () => {
    expect(pWinGame(0.55, 0, 0, false)).toBeGreaterThan(pWinGame(0.45, 0, 0, false))
  })
})

describe('pWinGame (golden point / no-ad)', () => {
  it('40-40 is decided by a single point = p', () => {
    expect(pWinGame(0.6, 3, 3, true)).toBeCloseTo(0.6, 9)
  })
  it('first to 4 wins regardless of margin', () => {
    expect(pWinGame(0.6, 4, 3, true)).toBe(1)
    expect(pWinGame(0.6, 3, 4, true)).toBe(0)
  })
})

describe('pWinTiebreak', () => {
  it('0.5 at 0-0 when p=0.5', () => {
    expect(pWinTiebreak(0.5, 0, 0)).toBeCloseTo(0.5, 6)
  })
  it('deuce at 6-6 uses the closed form', () => {
    const p = 0.6, q = 0.4
    expect(pWinTiebreak(p, 6, 6)).toBeCloseTo((p * p) / (p * p + q * q), 9)
  })
  it('terminal: 7-5 wins, 5-7 loses', () => {
    expect(pWinTiebreak(0.6, 7, 5)).toBe(1)
    expect(pWinTiebreak(0.6, 5, 7)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it (red)** — `npx vitest run "src/lib/odds/__tests__/scoring.test.ts"` → FAIL (cannot resolve `../scoring`).

- [ ] **Step 3: Implement the game + tiebreak parts of `scoring.ts`** (set/match added in Task 3 — write the whole file now with these two exports; Task 3 appends to the same file)

```ts
// src/lib/odds/scoring.ts
// Analytic padel scoring win-probability. Serve-neutral: a single per-point
// probability `p` for the favorite. Self-contained (no imports) for mirroring.

function deuceWin(p: number): number {
  const q = 1 - p
  return (p * p) / (p * p + q * q) // P(win | at deuce)
}

/** P(favorite wins a game) from point counts a..b. goldenPoint = no-ad rule. */
export function pWinGame(p: number, a: number, b: number, goldenPoint: boolean): number {
  const q = 1 - p
  const d = deuceWin(p)
  function rec(a: number, b: number): number {
    if (goldenPoint) {
      if (a >= 4) return 1
      if (b >= 4) return 0
      if (a === 3 && b === 3) return p // golden point decides
      return p * rec(a + 1, b) + q * rec(a, b + 1)
    }
    if (a >= 4 && a - b >= 2) return 1
    if (b >= 4 && b - a >= 2) return 0
    if (a >= 3 && b >= 3) {
      if (a === b) return d
      if (a === b + 1) return p + q * d // advantage favorite
      if (b === a + 1) return p * d // advantage opponent
    }
    return p * rec(a + 1, b) + q * rec(a, b + 1)
  }
  return rec(a, b)
}

/** P(favorite wins a tiebreak) from points a..b (first to 7, win by 2). */
export function pWinTiebreak(p: number, a: number, b: number): number {
  const q = 1 - p
  const d = deuceWin(p)
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
```

- [ ] **Step 4: Run it (green)** — `npx vitest run "src/lib/odds/__tests__/scoring.test.ts"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/odds/scoring.ts src/lib/odds/__tests__/scoring.test.ts
git commit -m "feat(odds): analytic game + tiebreak win probability"
```

---

## Task 3: Set + match win probability + anchor

**Files:**
- Modify: `src/lib/odds/scoring.ts` (append exports)
- Modify: `src/lib/odds/__tests__/scoring.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests**

```ts
// append to src/lib/odds/__tests__/scoring.test.ts
import { pWinMatchFav, anchorPerPoint } from '../scoring'
import type { ScoreState } from '../types'

const zero: ScoreState = {
  setsWon: [0, 0], gamesInSet: [0, 0], currentGamePoints: [0, 0],
  inTiebreak: false, tiebreakPoints: [0, 0], goldenPoint: false,
}

describe('pWinMatchFav', () => {
  it('is 0.5 at the start when p=0.5', () => {
    expect(pWinMatchFav(0.5, zero)).toBeCloseTo(0.5, 4)
  })
  it('best-of-3: ~1 when favorite leads two sets... (already won) and one set', () => {
    expect(pWinMatchFav(0.55, { ...zero, setsWon: [2, 0] })).toBe(1)
    expect(pWinMatchFav(0.55, { ...zero, setsWon: [0, 2] })).toBe(0)
  })
  it('monotonic: more games in the current set never lowers the prob', () => {
    const a = pWinMatchFav(0.55, { ...zero, gamesInSet: [5, 0] })
    const b = pWinMatchFav(0.55, { ...zero, gamesInSet: [0, 5] })
    expect(a).toBeGreaterThan(b)
  })
  it('a serving favorite at 40-0, 5-0, 1 set up is nearly certain', () => {
    const s: ScoreState = { ...zero, setsWon: [1, 0], gamesInSet: [5, 0], currentGamePoints: [3, 0] }
    expect(pWinMatchFav(0.55, s)).toBeGreaterThan(0.99)
  })
})

describe('anchorPerPoint', () => {
  it('finds p such that the 0-0 match prob equals the target (within 1e-4)', () => {
    for (const target of [0.55, 0.65, 0.8]) {
      const p = anchorPerPoint(target, false)
      expect(pWinMatchFav(p, zero)).toBeCloseTo(target, 4)
      expect(p).toBeGreaterThan(0.5)
      expect(p).toBeLessThan(1)
    }
  })
})
```

- [ ] **Step 2: Run it (red)** — `npx vitest run "src/lib/odds/__tests__/scoring.test.ts"` → FAIL (no `pWinMatchFav`/`anchorPerPoint`).

- [ ] **Step 3: Append set/match/anchor to `scoring.ts`**

```ts
// append to src/lib/odds/scoring.ts
import type { ScoreState } from './types'

/** P(favorite wins a full set) from games ga..gb (current game already resolved). */
export function pWinSetFromGames(p: number, ga: number, gb: number, goldenPoint: boolean): number {
  const G = pWinGame(p, 0, 0, goldenPoint) // full game from scratch
  function rec(ga: number, gb: number): number {
    if (ga >= 6 && ga - gb >= 2) return 1
    if (gb >= 6 && gb - ga >= 2) return 0
    if (ga === 6 && gb === 6) return pWinTiebreak(p, 0, 0)
    return G * rec(ga + 1, gb) + (1 - G) * rec(ga, gb + 1)
  }
  return rec(ga, gb)
}

/** P(favorite wins best-of-3) from completed sets sa..sb (current set already resolved). */
export function pWinMatchFromSets(p: number, sa: number, sb: number, goldenPoint: boolean): number {
  const S = pWinSetFromGames(p, 0, 0, goldenPoint) // full set from scratch
  function rec(sa: number, sb: number): number {
    if (sa >= 2) return 1
    if (sb >= 2) return 0
    return S * rec(sa + 1, sb) + (1 - S) * rec(sa, sb + 1)
  }
  return rec(sa, sb)
}

/** P(favorite wins the current set) incorporating current games + current game/tiebreak points. */
function pCurrentSetWin(p: number, s: ScoreState): number {
  const [ga, gb] = s.gamesInSet
  if (s.inTiebreak) return pWinTiebreak(p, s.tiebreakPoints[0], s.tiebreakPoints[1])
  const gNow = pWinGame(p, s.currentGamePoints[0], s.currentGamePoints[1], s.goldenPoint)
  return gNow * pWinSetFromGames(p, ga + 1, gb, s.goldenPoint)
    + (1 - gNow) * pWinSetFromGames(p, ga, gb + 1, s.goldenPoint)
}

/** Full match-win probability for the FAVORITE, given per-point p and a pair1-oriented... no:
 *  `s` here must already be oriented to the favorite (favorite = "a" side). */
export function pWinMatchFav(p: number, s: ScoreState): number {
  const setNow = pCurrentSetWin(p, s)
  const [sa, sb] = s.setsWon
  return setNow * pWinMatchFromSets(p, sa + 1, sb, s.goldenPoint)
    + (1 - setNow) * pWinMatchFromSets(p, sa, sb + 1, s.goldenPoint)
}

/** Binary-search the per-point probability p so the 0-0 match prob equals `target`. */
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

- [ ] **Step 4: Run it (green)** — `npx vitest run "src/lib/odds/__tests__/scoring.test.ts"` → PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/odds/scoring.ts src/lib/odds/__tests__/scoring.test.ts
git commit -m "feat(odds): set + match win probability + per-point anchor"
```

---

## Task 4: `computeOdds` (orient to favorite + confidence)

**Files:**
- Create: `src/lib/odds/index.ts`
- Test: `src/lib/odds/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/odds/__tests__/index.test.ts
import { describe, it, expect } from 'vitest'
import { computeOdds } from '../index'
import type { OddsInput, ScoreState } from '../types'

const liveZero: ScoreState = {
  setsWon: [0, 0], gamesInSet: [0, 0], currentGamePoints: [0, 0],
  inTiebreak: false, tiebreakPoints: [0, 0], goldenPoint: false,
}

describe('computeOdds', () => {
  it('pre-match (score=null): equals the ranking prior, confidence "pre-match"', () => {
    const r = computeOdds({ rankings: [1, 2, 200, 210], score: null, pointByPoint: false })
    expect(r.pair1WinProb).toBeCloseTo(0.8, 5)
    expect(r.pair2WinProb).toBeCloseTo(0.2, 5)
    expect(r.confidence).toBe('pre-match')
    expect(r.pair1FairOdds).toBe(1.25)
  })

  it('unranked → 50/50 and confidence "thin"', () => {
    const r = computeOdds({ rankings: [1, 2, 3, null], score: null, pointByPoint: false })
    expect(r.pair1WinProb).toBe(0.5)
    expect(r.confidence).toBe('thin')
  })

  it('live at 0-0 ≈ the prior (anchor identity), confidence "full" with point data', () => {
    const input: OddsInput = { rankings: [1, 2, 200, 210], score: liveZero, pointByPoint: true }
    const r = computeOdds(input)
    expect(r.pair1WinProb).toBeCloseTo(0.8, 3)
    expect(r.confidence).toBe('full')
  })

  it('live but no point feed → confidence "med"', () => {
    const r = computeOdds({ rankings: [50, 50, 60, 60], score: liveZero, pointByPoint: false })
    expect(r.confidence).toBe('med')
  })

  it('orients the score to the favorite: pair2 stronger + leading reads as pair2 favored', () => {
    const score: ScoreState = { ...liveZero, setsWon: [0, 1], gamesInSet: [0, 4] }
    const r = computeOdds({ rankings: [200, 210, 1, 2], score, pointByPoint: true })
    expect(r.pair2WinProb).toBeGreaterThan(0.8)
    expect(r.pair1WinProb + r.pair2WinProb).toBeCloseTo(1, 10)
  })
})
```

- [ ] **Step 2: Run it (red)** — `npx vitest run "src/lib/odds/__tests__/index.test.ts"` → FAIL (cannot resolve `../index`).

- [ ] **Step 3: Implement `index.ts`**

```ts
// src/lib/odds/index.ts
import type { OddsInput, OddsResult, ScoreState, Confidence } from './types'
import { preMatchProb, fairOdds } from './prematch'
import { anchorPerPoint, pWinMatchFav } from './scoring'

/** Flip a pair1-oriented score so the favorite is the "a" side. */
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

export function computeOdds(input: OddsInput): OddsResult {
  const prior = preMatchProb(input.rankings)
  // pair1 win prob first, then optionally move it live.
  let p1: number
  if (input.score === null) {
    p1 = prior.p1
  } else {
    const favorite: 1 | 2 = prior.p1 >= prior.p2 ? 1 : 2
    const target = Math.max(prior.p1, prior.p2)               // favorite's prior
    const p = anchorPerPoint(target, input.score.goldenPoint) // per-point prob
    const favProb = pWinMatchFav(p, orientToFavorite(input.score, favorite))
    p1 = favorite === 1 ? favProb : 1 - favProb
  }
  const p2 = 1 - p1

  let confidence: Confidence
  if (prior.fallback) confidence = 'thin'
  else if (input.score === null) confidence = 'pre-match'
  else confidence = input.pointByPoint ? 'full' : 'med'

  return {
    pair1WinProb: p1,
    pair2WinProb: p2,
    pair1FairOdds: fairOdds(p1),
    pair2FairOdds: fairOdds(p2),
    confidence,
  }
}
```

- [ ] **Step 4: Run it (green)** — `npx vitest run "src/lib/odds/__tests__/index.test.ts"` → PASS (5 tests).

- [ ] **Step 5: Run the whole odds suite + typecheck**

Run: `npx vitest run "src/lib/odds" && npx tsc --noEmit`
Expected: all odds tests pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/odds/index.ts src/lib/odds/__tests__/index.test.ts
git commit -m "feat(odds): computeOdds — favorite orientation + confidence + fair odds"
```

---

# PHASE 2 — Pipeline (model mirror, tables, extractor, worker)

## Task 5: Mirror the model into padelgod

**Files:**
- Create: `padelgod/src/lib/odds/{types.ts,prematch.ts,scoring.ts,index.ts}`
- Test: `padelgod/src/__tests__/odds-mirror.test.ts`

- [ ] **Step 1: Copy the four model files byte-for-byte**

```bash
mkdir -p padelgod/src/lib/odds
cp src/lib/odds/types.ts    padelgod/src/lib/odds/types.ts
cp src/lib/odds/prematch.ts padelgod/src/lib/odds/prematch.ts
cp src/lib/odds/scoring.ts  padelgod/src/lib/odds/scoring.ts
cp src/lib/odds/index.ts    padelgod/src/lib/odds/index.ts
```
These files are self-contained (no `@/` imports), so they compile unchanged in padelgod. Add a one-line header comment to each noting it is a byte-identical mirror of `src/lib/odds/<file>` (the canonical, tested copy).

- [ ] **Step 2: Write a mirror sanity test**

```ts
// padelgod/src/__tests__/odds-mirror.test.ts
import { describe, it, expect } from 'vitest'
import { computeOdds } from '../lib/odds'

describe('odds mirror', () => {
  it('computes a pre-match prior in padelgod', () => {
    const r = computeOdds({ rankings: [1, 2, 200, 210], score: null, pointByPoint: false })
    expect(r.pair1WinProb).toBeCloseTo(0.8, 5)
    expect(r.confidence).toBe('pre-match')
  })
})
```

- [ ] **Step 3: Run + typecheck** — `cd padelgod && npx vitest run "src/__tests__/odds-mirror.test.ts" && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/lib/odds padelgod/src/__tests__/odds-mirror.test.ts
git commit -m "feat(odds): mirror model into padelgod"
```

---

## Task 6: Migration — `match_odds` + `match_odds_snapshots`

**Files:**
- Create: `supabase/migrations/20260530120000_match_odds.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260530120000_match_odds.sql
-- Live win-probability + fair odds per match (latest) + append-only history.

create table if not exists public.match_odds (
  match_id        uuid primary key references public.matches(id) on delete cascade,
  pair1_win_prob  numeric(5,4) not null,
  pair2_win_prob  numeric(5,4) not null,
  pair1_fair_odds numeric(7,2) not null,
  pair2_fair_odds numeric(7,2) not null,
  confidence      text not null check (confidence in ('full','med','pre-match','thin')),
  model_version   text not null default 'v1',
  computed_at     timestamptz not null default now()
);

create table if not exists public.match_odds_snapshots (
  id             bigint generated always as identity primary key,
  match_id       uuid not null references public.matches(id) on delete cascade,
  pair1_win_prob numeric(5,4) not null,
  computed_at    timestamptz not null default now()
);
create index if not exists match_odds_snapshots_match_time_idx
  on public.match_odds_snapshots (match_id, computed_at desc);

-- RLS: anon may read (values are non-sensitive); writes are service-role only (bypasses RLS).
alter table public.match_odds enable row level security;
alter table public.match_odds_snapshots enable row level security;

drop policy if exists match_odds_read on public.match_odds;
create policy match_odds_read on public.match_odds for select to anon, authenticated using (true);

drop policy if exists match_odds_snapshots_read on public.match_odds_snapshots;
create policy match_odds_snapshots_read on public.match_odds_snapshots for select to anon, authenticated using (true);

-- Realtime: publish match_odds so the console receives live updates.
alter publication supabase_realtime add table public.match_odds;
```

- [ ] **Step 2: Verify SQL applies (local Supabase, if available)**

Run (only if a local Supabase is running): `supabase db reset` or apply the single migration. If no local DB is available, **statically verify** the SQL parses and matches the conventions of an existing migration in `supabase/migrations/` (column types, `enable row level security`, policy syntax, `alter publication`). Note in the commit if it was not applied locally.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260530120000_match_odds.sql
git commit -m "feat(odds): match_odds + match_odds_snapshots tables (RLS + realtime)"
```

---

## Task 7: Score-state extractor (pure)

**Files:**
- Create: `padelgod/src/lib/odds-state.ts`
- Test: `padelgod/src/__tests__/odds-state.test.ts`

Builds an `OddsInput` from already-fetched DB rows (pure → testable; the worker does the fetching). Padel default: **golden point = true** (standard in Premier/FIP).

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/__tests__/odds-state.test.ts
import { describe, it, expect } from 'vitest'
import { parsePadelPoints, buildOddsInput, type MatchRows } from '../lib/odds-state'

describe('parsePadelPoints', () => {
  it('maps padel point labels to counts', () => {
    expect(parsePadelPoints('0')).toBe(0)
    expect(parsePadelPoints('15')).toBe(1)
    expect(parsePadelPoints('30')).toBe(2)
    expect(parsePadelPoints('40')).toBe(3)
    expect(parsePadelPoints('AD')).toBe(4)
    expect(parsePadelPoints('A')).toBe(4)
  })
})

describe('buildOddsInput', () => {
  const base: MatchRows = {
    rankings: [1, 2, 200, 210],
    status: 'live',
    sets: [{ pair1_games: 4, pair2_games: 2, is_current: true }],
    currentGame: { game_score: '30-15', server_player_id: null },
    hasRecentPoints: true,
  }
  it('live with points → full confidence, oriented score', () => {
    const input = buildOddsInput(base)
    expect(input.pointByPoint).toBe(true)
    expect(input.score?.gamesInSet).toEqual([4, 2])
    expect(input.score?.currentGamePoints).toEqual([2, 1]) // 30-15
    expect(input.score?.goldenPoint).toBe(true)
  })
  it('scheduled → score null (pre-match)', () => {
    const input = buildOddsInput({ ...base, status: 'scheduled', sets: [], currentGame: null, hasRecentPoints: false })
    expect(input.score).toBeNull()
  })
  it('6-6 with a current game → tiebreak', () => {
    const input = buildOddsInput({
      ...base,
      sets: [{ pair1_games: 6, pair2_games: 6, is_current: true }],
      currentGame: { game_score: '5-3', server_player_id: null },
    })
    expect(input.score?.inTiebreak).toBe(true)
    expect(input.score?.tiebreakPoints).toEqual([5, 3])
  })
})
```

- [ ] **Step 2: Run it (red)** — `cd padelgod && npx vitest run "src/__tests__/odds-state.test.ts"` → FAIL.

- [ ] **Step 3: Implement `odds-state.ts`**

```ts
// padelgod/src/lib/odds-state.ts
import type { OddsInput, ScoreState } from './odds/types'

export interface MatchRows {
  rankings: [number | null, number | null, number | null, number | null]
  status: string // 'scheduled' | 'live' | 'on_court' | 'finished' | ...
  sets: Array<{ pair1_games: number; pair2_games: number; is_current: boolean }>
  currentGame: { game_score: string | null; server_player_id: string | null } | null
  hasRecentPoints: boolean // a match_points row inserted recently
}

const GOLDEN_POINT_DEFAULT = true // Premier/FIP standard

export function parsePadelPoints(label: string): number {
  const s = label.trim().toUpperCase()
  if (s === 'AD' || s === 'A') return 4
  if (s === '40') return 3
  if (s === '30') return 2
  if (s === '15') return 1
  if (s === '0' || s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0 // tiebreak raw numbers fall through here
}

function parsePair(score: string | null): [number, number] {
  if (!score) return [0, 0]
  const [a, b] = score.split('-').map((x) => x.trim())
  return [parsePadelPoints(a ?? '0'), parsePadelPoints(b ?? '0')]
}

const LIVE_STATUSES = new Set(['live', 'on_court', 'break'])

export function buildOddsInput(rows: MatchRows): OddsInput {
  const isLive = LIVE_STATUSES.has(rows.status)
  if (!isLive) {
    return { rankings: rows.rankings, score: null, pointByPoint: false }
  }
  const current = rows.sets.find((s) => s.is_current) ?? rows.sets[rows.sets.length - 1]
  const setsWon: [number, number] = rows.sets
    .filter((s) => s !== current)
    .reduce<[number, number]>(
      (acc, s) => [acc[0] + (s.pair1_games > s.pair2_games ? 1 : 0), acc[1] + (s.pair2_games > s.pair1_games ? 1 : 0)],
      [0, 0],
    )
  const gamesInSet: [number, number] = current ? [current.pair1_games, current.pair2_games] : [0, 0]
  const inTiebreak = gamesInSet[0] === 6 && gamesInSet[1] === 6 && rows.currentGame != null
  const rawPts = parsePair(rows.currentGame?.game_score ?? null)

  const score: ScoreState = {
    setsWon,
    gamesInSet,
    currentGamePoints: inTiebreak ? [0, 0] : rawPts,
    inTiebreak,
    tiebreakPoints: inTiebreak ? rawPts : [0, 0],
    goldenPoint: GOLDEN_POINT_DEFAULT,
  }
  return { rankings: rows.rankings, score, pointByPoint: rows.hasRecentPoints }
}
```

- [ ] **Step 4: Run it (green)** — `cd padelgod && npx vitest run "src/__tests__/odds-state.test.ts"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/odds-state.ts padelgod/src/__tests__/odds-state.test.ts
git commit -m "feat(odds): pure DB-rows → OddsInput extractor"
```

---

## Task 8: `odds-computer` worker + scheduler registration

**Files:**
- Create: `padelgod/src/workers/odds-computer.ts`
- Modify: `padelgod/src/scheduler.ts` (register worker + schedule entry)

- [ ] **Step 1: Implement the worker**

Reads live + scheduled matches, builds inputs via `buildOddsInput`, computes via `computeOdds`, upserts `match_odds` + inserts a snapshot. Idempotent pre-match (skip rows priced < 5 min ago). Mirror existing worker conventions (read another worker, e.g. `padelgod/src/workers/player-rankings.ts`, for the `deps` shape, logging, and Supabase query style; use `paginatedSelect` from `padelgod/src/lib/db-paginate` for the match scan).

```ts
// padelgod/src/workers/odds-computer.ts
import type { SchedulerDeps } from '../scheduler'
import { computeOdds } from '../lib/odds'
import { buildOddsInput, type MatchRows } from '../lib/odds-state'

const LIVE = ['live', 'on_court', 'break']
const PREMATCH_TTL_MS = 5 * 60 * 1000

interface MatchRow {
  id: string
  status: string
  pair1_player1_id: string | null; pair1_player2_id: string | null
  pair2_player1_id: string | null; pair2_player2_id: string | null
}

export async function runOddsComputer(deps: SchedulerDeps): Promise<{
  computedLive: number; computedPreMatch: number; skipped: number; errors: number
}> {
  const { supabase, logger } = deps
  let computedLive = 0, computedPreMatch = 0, skipped = 0, errors = 0

  // 1) Candidate matches: live + scheduled within an active window (next/now ~1 day).
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const until = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString()
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id,status,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id,scheduled_at')
    .or(`status.in.(${LIVE.join(',')}),and(status.eq.scheduled,scheduled_at.gte.${since},scheduled_at.lte.${until})`)
    .returns<MatchRow[]>()
  if (error) { logger.error({ worker: 'odds-computer', error: error.message }, 'match query failed'); return { computedLive, computedPreMatch, skipped, errors: 1 } }

  // 2) Existing match_odds freshness (to skip recently-priced pre-match rows).
  const ids = (matches ?? []).map((m) => m.id)
  const fresh = new Map<string, number>()
  if (ids.length) {
    const { data: existing } = await supabase.from('match_odds').select('match_id,computed_at').in('match_id', ids)
    for (const r of existing ?? []) fresh.set(r.match_id as string, new Date(r.computed_at as string).getTime())
  }

  for (const m of matches ?? []) {
    try {
      const isLive = LIVE.includes(m.status)
      if (!isLive) {
        const last = fresh.get(m.id)
        if (last && Date.now() - last < PREMATCH_TTL_MS) { skipped++; continue } // recently priced
      }
      const rows = await loadMatchRows(supabase, m)
      const result = computeOdds(buildOddsInput(rows))
      await supabase.from('match_odds').upsert({
        match_id: m.id,
        pair1_win_prob: result.pair1WinProb,
        pair2_win_prob: result.pair2WinProb,
        pair1_fair_odds: result.pair1FairOdds,
        pair2_fair_odds: result.pair2FairOdds,
        confidence: result.confidence,
        model_version: 'v1',
        computed_at: new Date().toISOString(),
      }, { onConflict: 'match_id' })
      if (isLive) {
        await supabase.from('match_odds_snapshots').insert({ match_id: m.id, pair1_win_prob: result.pair1WinProb })
        computedLive++
      } else {
        computedPreMatch++
      }
    } catch (e) {
      errors++
      logger.warn({ worker: 'odds-computer', matchId: m.id, err: String(e) }, 'odds compute failed for match')
    }
  }
  logger.info({ worker: 'odds-computer', computedLive, computedPreMatch, skipped, errors }, 'odds-computer done')
  return { computedLive, computedPreMatch, skipped, errors }
}

// Fetch rankings + current set/game + recent-point flag for one match.
async function loadMatchRows(
  supabase: SchedulerDeps['supabase'],
  m: MatchRow,
): Promise<MatchRows> {
  const playerIds = [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]
  const ranks = new Map<string, number | null>()
  const present = playerIds.filter((x): x is string => !!x)
  if (present.length) {
    const { data: players } = await supabase.from('players').select('id,ranking').in('id', present)
    for (const p of players ?? []) ranks.set(p.id as string, (p.ranking as number | null) ?? null)
  }
  const rankings = playerIds.map((id) => (id ? ranks.get(id) ?? null : null)) as MatchRows['rankings']

  const isLive = LIVE.includes(m.status)
  if (!isLive) return { rankings, status: m.status, sets: [], currentGame: null, hasRecentPoints: false }

  const { data: sets } = await supabase
    .from('sets').select('pair1_games,pair2_games,is_current').eq('match_id', m.id).order('set_number', { ascending: true })
  const { data: games } = await supabase
    .from('games').select('game_score,server_player_id,is_current').eq('match_id', m.id).eq('is_current', true).limit(1)
  const recentPointCutoff = new Date(Date.now() - 90 * 1000).toISOString()
  const { count } = await supabase
    .from('match_points').select('point_number', { count: 'exact', head: true })
    .eq('match_id', m.id).gte('created_at', recentPointCutoff)

  return {
    rankings,
    status: m.status,
    sets: (sets ?? []) as MatchRows['sets'],
    currentGame: games && games[0] ? { game_score: games[0].game_score as string | null, server_player_id: games[0].server_player_id as string | null } : null,
    hasRecentPoints: (count ?? 0) > 0,
  }
}
```

- [ ] **Step 2: Register the worker in `scheduler.ts`**

In `getWorkerRunner`, add (next to the other cases):
```ts
    case 'odds-computer':        return (deps) => runOddsComputer(deps);
```
Add the import at the top (mirror the other worker imports):
```ts
import { runOddsComputer } from './workers/odds-computer';
```
In `buildSchedule(...)`, add an entry (node-cron 6-field = seconds; every 15s):
```ts
    entries.push({
      name: 'odds-computer',
      cron: '*/15 * * * * *', // every 15 seconds
      run: getWorkerRunner('odds-computer')!,
    });
```
If `WORKER_NAMES`/registry arrays exist (e.g. the list near line 160), add `'odds-computer'` there too, following the existing pattern exactly.

- [ ] **Step 3: Typecheck + scheduler test**

Run: `cd padelgod && npx tsc --noEmit && npx vitest run "src/__tests__/scheduler.test.ts"`
Expected: no type errors; scheduler tests pass (update the test only if it asserts the worker list — add `'odds-computer'` to the expected set, matching the existing assertion style).

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/workers/odds-computer.ts padelgod/src/scheduler.ts padelgod/src/__tests__/scheduler.test.ts
git commit -m "feat(odds): odds-computer worker + scheduler registration"
```

---

# PHASE 3 — UI real provider (apps/ops)

> Runs with `apps/ops` vitest (`cd apps/ops && npx vitest run "<path>"`; tests `import { describe,it,expect } from 'vitest'`). Existing contract: `apps/ops/src/app/(app)/live-odds/_lib/types.ts` (`Match`, `Kpis`, `Confidence='full'|'med'|'low'`, `MatchStatus='Live'|'Break'|'Scheduled'`).

## Task 9: Pure mappers — `mapOddsRow` + `movementFromSnapshots`

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_lib/map-odds.ts`
- Test: `apps/ops/src/app/(app)/live-odds/_lib/__tests__/map-odds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ops/src/app/(app)/live-odds/_lib/__tests__/map-odds.test.ts
import { describe, it, expect } from 'vitest'
import { mapConfidence, mapStatus, movementFromSnapshots } from '../map-odds'

describe('mapConfidence', () => {
  it('maps model confidence to the UI 3-level scale', () => {
    expect(mapConfidence('full')).toBe('full')
    expect(mapConfidence('med')).toBe('med')
    expect(mapConfidence('pre-match')).toBe('med')
    expect(mapConfidence('thin')).toBe('low')
  })
})

describe('mapStatus', () => {
  it('maps match status to the UI status', () => {
    expect(mapStatus('live')).toBe('Live')
    expect(mapStatus('on_court')).toBe('Live')
    expect(mapStatus('break')).toBe('Break')
    expect(mapStatus('scheduled')).toBe('Scheduled')
    expect(mapStatus('finished')).toBe('Scheduled') // non-live treated as static
  })
})

describe('movementFromSnapshots', () => {
  const now = Date.now()
  const snaps = [
    { match_id: 'm1', pair1_win_prob: 0.50, computed_at: new Date(now - 16 * 60000).toISOString() },
    { match_id: 'm1', pair1_win_prob: 0.62, computed_at: new Date(now - 1 * 60000).toISOString() },
  ]
  it('is latest minus nearest-to-15m-ago, in percentage points', () => {
    expect(movementFromSnapshots(snaps, 'm1', now)).toBe(12) // 0.62 - 0.50 → +12
  })
  it('is 0 when there is no ~15m-ago snapshot', () => {
    expect(movementFromSnapshots([snaps[1]], 'm1', now)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it (red)** — `cd apps/ops && npx vitest run "src/app/(app)/live-odds/_lib/__tests__/map-odds.test.ts"` → FAIL.

- [ ] **Step 3: Implement `map-odds.ts`**

```ts
// apps/ops/src/app/(app)/live-odds/_lib/map-odds.ts
import type { Confidence, MatchStatus } from './types'

export function mapConfidence(c: string): Confidence {
  if (c === 'full') return 'full'
  if (c === 'med' || c === 'pre-match') return 'med'
  return 'low' // 'thin'
}

export function mapStatus(s: string): MatchStatus {
  if (s === 'live' || s === 'on_court') return 'Live'
  if (s === 'break') return 'Break'
  return 'Scheduled'
}

export interface SnapshotRow { match_id: string; pair1_win_prob: number; computed_at: string }

/** Latest pair1 win% minus the snapshot nearest to 15m ago, in percentage points. */
export function movementFromSnapshots(rows: SnapshotRow[], matchId: string, nowMs = Date.now()): number {
  const mine = rows.filter((r) => r.match_id === matchId).sort((a, b) => +new Date(a.computed_at) - +new Date(b.computed_at))
  if (mine.length === 0) return 0
  const latest = mine[mine.length - 1]
  const target = nowMs - 15 * 60000
  const old = mine.find((r) => +new Date(r.computed_at) <= target)
  if (!old) return 0
  return Math.round((latest.pair1_win_prob - old.pair1_win_prob) * 100)
}
```

- [ ] **Step 4: Run it (green)** — `cd apps/ops && npx vitest run "src/app/(app)/live-odds/_lib/__tests__/map-odds.test.ts"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_lib/map-odds.ts" "apps/ops/src/app/(app)/live-odds/_lib/__tests__/map-odds.test.ts"
git commit -m "feat(ops): pure mappers for confidence/status/movement"
```

---

## Task 10: Realtime provider + `useLiveOdds` swap (stub kept as fallback)

**Files:**
- Create: `apps/ops/src/app/(app)/live-odds/_lib/realtime-provider.ts`
- Modify: `apps/ops/src/app/(app)/live-odds/_lib/useLiveOdds.ts`

- [ ] **Step 1: Implement the realtime provider**

Exposes the **same shape** as `createStubFeed` (`subscribe/start/stop`) plus `fetchHistory(matchId)`. Reads `match_odds` joined to `matches` (+ players/sets/current game) and pushes a `LiveOddsSnapshot`; resubscribes via Supabase Realtime. The nested-select aliases below must match the actual FK relationship names in the Supabase schema — verify against `apps/ops`'s Supabase types and fix any alias the API rejects.

```ts
// apps/ops/src/app/(app)/live-odds/_lib/realtime-provider.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { LiveOddsSnapshot, Match } from './types'
import { mapConfidence, mapStatus, movementFromSnapshots, type SnapshotRow } from './map-odds'
import { computeKpis } from './odds-math'

function browserClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )
}

// Shape returned by the joined select (adjust aliases to the real schema if needed).
interface JoinedRow {
  match_id: string
  pair1_win_prob: number; pair2_win_prob: number
  pair1_fair_odds: number; pair2_fair_odds: number
  confidence: string; computed_at: string
  matches: {
    status: string; court: string | null; round: string | null; scheduled_at: string | null; category: string | null
    tournament: { name: string | null } | null
    p1a: { name: string | null } | null; p1b: { name: string | null } | null
    p2a: { name: string | null } | null; p2b: { name: string | null } | null
    sets: Array<{ pair1_games: number; pair2_games: number; is_current: boolean; set_number: number }>
    games: Array<{ game_score: string | null; is_current: boolean; server_player_id: string | null }>
  } | null
}

const SELECT =
  'match_id,pair1_win_prob,pair2_win_prob,pair1_fair_odds,pair2_fair_odds,confidence,computed_at,' +
  'matches!inner(status,court,round,scheduled_at,category,' +
  'tournament:tournaments(name),' +
  'p1a:players!matches_pair1_player1_id_fkey(name),p1b:players!matches_pair1_player2_id_fkey(name),' +
  'p2a:players!matches_pair2_player1_id_fkey(name),p2b:players!matches_pair2_player2_id_fkey(name),' +
  'sets(pair1_games,pair2_games,is_current,set_number),games(game_score,is_current,server_player_id))'

function pairName(a?: { name: string | null } | null, b?: { name: string | null } | null): string {
  return [a?.name, b?.name].filter(Boolean).join(' / ') || 'TBD'
}

function mapRow(r: JoinedRow, snaps: SnapshotRow[]): Match {
  const m = r.matches
  const gender: 'men' | 'women' = m?.category === 'women' ? 'women' : 'men'
  const sets = (m?.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
  const current = m?.games?.find((g) => g.is_current) ?? null
  return {
    id: r.match_id,
    pair1: { name: pairName(m?.p1a, m?.p1b), gender, serving: false },
    pair2: { name: pairName(m?.p2a, m?.p2b), gender, serving: false },
    tournament: m?.tournament?.name ?? '',
    tournamentShort: m?.tournament?.name ?? '',
    court: m?.court ?? '', round: m?.round ?? '',
    setScores: sets.map((s) => ({ a: s.pair1_games, b: s.pair2_games, current: s.is_current })),
    gamePoints: current?.game_score
      ? { a: current.game_score.split('-')[0] ?? '', b: current.game_score.split('-')[1] ?? '' }
      : null,
    status: mapStatus(m?.status ?? 'scheduled'),
    scheduledTime: m?.scheduled_at ? new Date(m.scheduled_at).toISOString().slice(11, 16) : undefined,
    winProbA: Math.round(r.pair1_win_prob * 100),
    fairOddsA: r.pair1_fair_odds, fairOddsB: r.pair2_fair_odds,
    movement15m: movementFromSnapshots(snaps, r.match_id),
    confidence: mapConfidence(r.confidence),
    lastUpdatedSeconds: Math.max(0, Math.round((Date.now() - +new Date(r.computed_at)) / 1000)),
    winProbHistory: [],
  }
}

export type FeedListener = (s: LiveOddsSnapshot) => void
export type ConnListener = (state: 'live' | 'reconnecting' | 'offline') => void

export function createRealtimeFeed() {
  const supabase = browserClient()
  let listeners: FeedListener[] = []
  let connListeners: ConnListener[] = []
  let channel: ReturnType<SupabaseClient['channel']> | null = null

  async function refresh() {
    const { data, error } = await supabase.from('match_odds').select(SELECT).returns<JoinedRow[]>()
    if (error) { connListeners.forEach((l) => l('offline')); return }
    const ids = data.map((r) => r.match_id)
    let snaps: SnapshotRow[] = []
    if (ids.length) {
      const since = new Date(Date.now() - 16 * 60000).toISOString()
      const { data: sd } = await supabase.from('match_odds_snapshots')
        .select('match_id,pair1_win_prob,computed_at').in('match_id', ids).gte('computed_at', since)
      snaps = (sd ?? []) as SnapshotRow[]
    }
    const matches = data.map((r) => mapRow(r, snaps))
    const snapshot: LiveOddsSnapshot = { matches, kpis: computeKpis(matches) }
    listeners.forEach((l) => l(snapshot))
  }

  return {
    subscribe(fn: FeedListener) { listeners.push(fn); refresh(); return () => { listeners = listeners.filter((l) => l !== fn) } },
    onConnection(fn: ConnListener) { connListeners.push(fn); return () => { connListeners = connListeners.filter((l) => l !== fn) } },
    start() {
      channel = supabase
        .channel('match_odds')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'match_odds' }, () => refresh())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') connListeners.forEach((l) => l('live'))
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') connListeners.forEach((l) => l('reconnecting'))
          else if (status === 'CLOSED') connListeners.forEach((l) => l('offline'))
        })
    },
    stop() { if (channel) { supabase.removeChannel(channel); channel = null } },
    async fetchHistory(matchId: string): Promise<number[]> {
      const { data } = await supabase.from('match_odds_snapshots')
        .select('pair1_win_prob,computed_at').eq('match_id', matchId).order('computed_at', { ascending: true }).limit(60)
      return (data ?? []).map((r) => Math.round((r.pair1_win_prob as number) * 100))
    },
  }
}
```

- [ ] **Step 2: Swap `useLiveOdds` to the realtime feed (keep the stub as dev fallback)**

Modify `useLiveOdds.ts`: pick the feed by env flag so the env-free `/live-odds-preview` keeps working on the stub, while the real route uses realtime.
```ts
// near the top of useLiveOdds(), replace the `feed` creation:
const useStub = process.env.NEXT_PUBLIC_LIVE_ODDS_SOURCE === 'stub'
const feed = useMemo(() => (useStub ? createStubFeed(reduced) : createRealtimeFeed()), [reduced, useStub])
```
Keep the existing boot/motion effects, but: when on the realtime feed, drive `connection` from the feed's `onConnection` (instead of the stub timer) and, on row-select, call `feed.fetchHistory(id)` to populate the selected match's `winProbHistory`. Guard the stub-only `feed.start()`/motion so it only runs for the stub; for realtime, `start()` opens the channel. Import both `createStubFeed` and `createRealtimeFeed`. Preserve the exact return shape of the hook (the components are unchanged).

- [ ] **Step 3: Typecheck + build + existing tests**

Run: `cd apps/ops && npx tsc --noEmit && npx vitest run "src/app/(app)/live-odds/_lib" && npm run build`
Expected: no type errors; lib tests pass; build succeeds.

- [ ] **Step 4: Manual runtime check (requires the worker + a DB with `match_odds` data)**

With env configured and the padelgod `odds-computer` worker having written some rows: open `/live-odds` — rows show real probabilities; the connection pill reflects the Realtime channel; selecting a row loads its history chart. (No data yet → empty list, "Model frozen/loading" — acceptable.)

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/live-odds/_lib/realtime-provider.ts" "apps/ops/src/app/(app)/live-odds/_lib/useLiveOdds.ts"
git commit -m "feat(ops): Supabase Realtime odds provider (stub kept as dev fallback)"
```

---

## Task 11: Docs + remove the temporary preview route

**Files:**
- Modify: `CLAUDE.md`
- Delete: `apps/ops/src/app/live-odds-preview/` (the temp env-free preview)

- [ ] **Step 1: Update the CLAUDE.md "Live Odds console" note**

In the `### Live Odds console` section, change the **Status** line to say the console now renders **real** model odds from `public.match_odds` (written by the padelgod `odds-computer` worker; model in `src/lib/odds/`, mirrored to `padelgod/src/lib/odds/`), delivered via Supabase Realtime; the stub remains the dev fallback behind `NEXT_PUBLIC_LIVE_ODDS_SOURCE=stub`. Add a one-liner: model = ranking pre-match prior (mirror of `src/lib/predictions/probability.ts`) anchored + an analytic in-play engine; spec at `docs/superpowers/specs/2026-05-30-live-odds-model-design.md`.

- [ ] **Step 2: Remove the temporary preview route** (it was only for env-free design viewing)

```bash
rm -rf "apps/ops/src/app/live-odds-preview"
```

- [ ] **Step 3: Build + commit**

```bash
cd apps/ops && npm run build && cd -
git add CLAUDE.md "apps/ops/src/app/live-odds-preview" 2>/dev/null; git add -A apps/ops/src/app
git commit -m "docs(ops): live odds now on real model data; remove temp preview route"
```

---

## Self-review notes (for the executor)
- Phase 1 (model) is fully unit-tested and **independently shippable** — land it first.
- Phase 2 needs a Supabase DB to apply the migration + a padelgod runtime to run the worker; its **pure** parts (extractor, model) are unit-tested; the worker is verified by `tsc` + the scheduler test, then by observing `match_odds` rows in a real environment.
- Phase 3's **pure** mappers are unit-tested; the realtime provider is verified by `tsc`/`build`, then manually against real `match_odds` data. The nested-select FK aliases (`matches_pair1_player1_id_fkey`, etc.) must be confirmed against the live schema.
- Serve-neutral v1; golden-point defaulted true; KPIs client-side — all per the spec's accepted defaults.
