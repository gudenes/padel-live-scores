# Guacas Prediction Game — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full prediction-game UX (corner CTA, inline pick flow, multipliers, guacas, result badges, /picks page) backed by localStorage. No DB changes.

**Architecture:**
- New `src/lib/predictions/` module: pure functions for probability, multiplier, result classification, reward — fully unit-tested with Vitest.
- New `src/components/prediction/` directory: `PredictionFlow` (pair-pick → margin-pick → confirmed) and `PredictionPanel` (full expanded panel = flow + analytics + community + sponsor). Used inline on cards and on the match-detail page.
- `MatchCard.tsx` gains a corner state machine (PICK / YOUR PICK / LOCKED / result-badge) and an animated expandable insights panel below the existing pair rows.
- `/picks` page reads localStorage and computes results lazily by joining against fetched matches.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind 4, next-intl, Vitest, existing chunky polygon visual language.

**Spec:** [docs/superpowers/specs/2026-04-30-guacas-prediction-game-design.md](../specs/2026-04-30-guacas-prediction-game-design.md)

---

## File Structure

**New files:**
```
src/lib/predictions/
  index.ts                     # barrel export
  types.ts                     # Prediction, PredictionResult, ProbabilityResult
  constants.ts                 # STAKE_GUACAS, MULTIPLIER_CAP, MARGIN_BONUS, PROB_CLAMP
  probability.ts               # computeMatchProbability, computeMultiplier
  scoring.ts                   # classifyResult, computeReward
src/lib/__tests__/predictions/
  probability.test.ts
  scoring.test.ts
src/components/prediction/
  PredictionFlow.tsx           # pair-pick → margin-pick → confirmed (action only)
  PredictionPanel.tsx          # full expanded panel (flow + analytics + community + sponsor)
  ResultBadge.tsx              # corner badge for finished+predicted matches
src/app/[locale]/picks/
  page.tsx                     # /picks route
  StatsHeader.tsx              # avatar + 4-tile stat strip
  PicksList.tsx                # filter chips + pick rows
```

**Modified files:**
```
src/hooks/useMatchPrediction.ts      # extend storage shape with multiplier + probability
src/components/MatchCard.tsx          # corner state machine + expandable panel
src/app/[locale]/match/[id]/PredictionSection.tsx  # delegate to <PredictionPanel>
src/messages/{en,es,pt,it,fr}.json    # prediction.* keys
```

---

### Task 1: Constants + types module

**Files:**
- Create: `src/lib/predictions/constants.ts`
- Create: `src/lib/predictions/types.ts`
- Create: `src/lib/predictions/index.ts`

- [ ] **Step 1: Write `constants.ts`**

```ts
// src/lib/predictions/constants.ts
//
// Tunables for the Guacas prediction economy. See
// docs/superpowers/specs/2026-04-30-guacas-prediction-game-design.md for
// the full rationale (stake size, cap, margin-bonus shape).

/** Every pick stakes 100 guacas. Not deducted from balance — it's the
 *  unit the multiplier scales. */
export const STAKE_GUACAS = 100

/** Base multiplier cap. A 20% underdog (the floor of PROB_CLAMP_MAX_INV)
 *  hits exactly 5.00x. */
export const MULTIPLIER_CAP = 5.00

/** Floor — a coin-flip is the minimum. Never less than 1.00x. */
export const MULTIPLIER_FLOOR = 1.00

/** Flat additive bonus on the multiplier when the user nails the margin
 *  too (2-0 or 2-1). With base cap 5.00, effective cap is 5.50x. */
export const MARGIN_BONUS = 0.50

/** Probability clamp. v1 model is conservative; we don't claim more than
 *  80% confidence based on rankings alone. v2/v3 (form, Elo) may produce
 *  more extreme probabilities. */
export const PROB_CLAMP_MIN = 0.20
export const PROB_CLAMP_MAX = 0.80

/** Probability threshold for the 🔥 UPSET badge. The user picked the
 *  eventual winner AND that pair's frozen probability was at or below
 *  this value. */
export const HEAVY_UPSET_THRESHOLD = 0.25

/** Below this min number of picks per match, we hide the community-%
 *  band (avoids "1 pick = 100%" degenerate cases). Tightens later. */
export const COMMUNITY_PICKS_MIN_THRESHOLD = 10
```

- [ ] **Step 2: Write `types.ts`**

```ts
// src/lib/predictions/types.ts

export type Pair = 1 | 2
export type Margin = '2-0' | '2-1'

export type PredictionResult =
  | 'perfect'      // pair correct + margin correct, prob > 0.25
  | 'right'        // pair correct, margin wrong
  | 'wrong'        // pair wrong
  | 'upset'        // pair correct AND that pair's prob ≤ 0.25 (precedence over perfect)
  | 'invalidated'  // match cancelled / walkover / retired before locking in

/** Stored prediction record. localStorage in Phase 1; DB row in Phase 2. */
export type Prediction = {
  matchId: string
  pair: Pair
  margin: Margin
  /** Frozen probability the user saw for THEIR chosen pair when locking in. */
  probability: number
  /** Frozen base multiplier (no margin bonus). */
  multiplier: number
  /** True when the model fell back to 50/50 (unranked players). */
  isFallback: boolean
  /** ISO timestamp of when the user locked in. */
  createdAt: string
}

/** Output of the probability function for a match. */
export type ProbabilityResult = {
  p1: number
  p2: number
  isFallback: boolean
}
```

- [ ] **Step 3: Write barrel `index.ts`**

```ts
// src/lib/predictions/index.ts
export * from './constants'
export * from './types'
export * from './probability'
export * from './scoring'
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/predictions/
git commit -m "feat(predictions): types + constants for guacas economy"
```

---

### Task 2: Probability + multiplier (TDD)

**Files:**
- Create: `src/lib/predictions/probability.ts`
- Create: `src/lib/__tests__/predictions/probability.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/predictions/probability.test.ts
import { describe, it, expect } from 'vitest'
import {
  computeMatchProbability,
  computeMultiplier,
} from '@/lib/predictions/probability'
import { MULTIPLIER_CAP, MULTIPLIER_FLOOR, MARGIN_BONUS } from '@/lib/predictions/constants'
import type { Match } from '@/types/match'

function mockMatch(p1Ranks: [number?, number?], p2Ranks: [number?, number?]): Match {
  return {
    id: 'm',
    pair1_player1: { ranking: p1Ranks[0] ?? null } as any,
    pair1_player2: { ranking: p1Ranks[1] ?? null } as any,
    pair2_player1: { ranking: p2Ranks[0] ?? null } as any,
    pair2_player2: { ranking: p2Ranks[1] ?? null } as any,
  } as Match
}

describe('computeMatchProbability', () => {
  it('returns 50/50 fallback when any player is unranked', () => {
    const r = computeMatchProbability(mockMatch([1, 2], [3, undefined]))
    expect(r.p1).toBe(0.5)
    expect(r.p2).toBe(0.5)
    expect(r.isFallback).toBe(true)
  })

  it('returns 50/50 fallback when all players are unranked', () => {
    const r = computeMatchProbability(mockMatch([], []))
    expect(r.isFallback).toBe(true)
  })

  it('favors the lower-ranked (better) pair', () => {
    const r = computeMatchProbability(mockMatch([1, 2], [50, 60]))
    expect(r.p1).toBeGreaterThan(0.5)
    expect(r.p2).toBeLessThan(0.5)
    expect(r.isFallback).toBe(false)
  })

  it('clamps probability to [0.20, 0.80]', () => {
    // extreme mismatch — top 2 vs unranked-tail
    const r = computeMatchProbability(mockMatch([1, 2], [900, 950]))
    expect(r.p1).toBeLessThanOrEqual(0.80)
    expect(r.p1).toBeGreaterThanOrEqual(0.20)
    expect(r.p2).toBeLessThanOrEqual(0.80)
    expect(r.p2).toBeGreaterThanOrEqual(0.20)
  })

  it('p1 + p2 always sums to 1', () => {
    for (const [a, b] of [[1, 2], [10, 20], [100, 100], [50, 200]] as const) {
      const r = computeMatchProbability(mockMatch([a, a + 1], [b, b + 1]))
      expect(r.p1 + r.p2).toBeCloseTo(1, 5)
    }
  })
})

describe('computeMultiplier', () => {
  it('returns 1/p rounded to 2 decimals for a typical favorite', () => {
    expect(computeMultiplier(0.68, false)).toBe(1.47)  // 1/0.68 = 1.470...
  })

  it('returns 1/p rounded to 2 decimals for an underdog', () => {
    expect(computeMultiplier(0.32, false)).toBe(3.13)  // 1/0.32 = 3.125
  })

  it('caps at MULTIPLIER_CAP for heavy upsets', () => {
    expect(computeMultiplier(0.10, false)).toBe(MULTIPLIER_CAP)
    expect(computeMultiplier(0.05, false)).toBe(MULTIPLIER_CAP)
  })

  it('floors at MULTIPLIER_FLOOR for impossible-favorite cases', () => {
    expect(computeMultiplier(1.0, false)).toBe(MULTIPLIER_FLOOR)
  })

  it('adds MARGIN_BONUS when marginCorrect=true (cap raises to 5.50)', () => {
    expect(computeMultiplier(0.68, true)).toBeCloseTo(1.47 + MARGIN_BONUS, 2)
    expect(computeMultiplier(0.10, true)).toBe(MULTIPLIER_CAP + MARGIN_BONUS)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/predictions/probability.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `probability.ts`**

```ts
// src/lib/predictions/probability.ts
//
// Pure model that turns a Match into per-pair win probabilities, plus
// the inverse-probability multiplier used by the Guacas economy.
//
// v1: ranking-based logistic, conservatively clamped to [0.20, 0.80].
// Anything missing a ranking falls back to 50/50 (toss-up UI).

import type { Match, Player } from '@/types/match'
import {
  MULTIPLIER_CAP,
  MULTIPLIER_FLOOR,
  MARGIN_BONUS,
  PROB_CLAMP_MIN,
  PROB_CLAMP_MAX,
} from './constants'
import type { ProbabilityResult } from './types'

function pairRankings(p1: Player | null | undefined, p2: Player | null | undefined): number[] {
  return [p1?.ranking, p2?.ranking].filter(
    (r): r is number => typeof r === 'number' && r > 0,
  )
}

function avgRanking(ranks: number[]): number | null {
  if (ranks.length === 0) return null
  return ranks.reduce((a, b) => a + b, 0) / ranks.length
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

export function computeMatchProbability(match: Match): ProbabilityResult {
  const p1Ranks = pairRankings(match.pair1_player1, match.pair1_player2)
  const p2Ranks = pairRankings(match.pair2_player1, match.pair2_player2)

  // Need at least one ranked player on each pair, AND none missing on either pair
  const allRanked =
    p1Ranks.length === 2 && p2Ranks.length === 2

  if (!allRanked) {
    return { p1: 0.5, p2: 0.5, isFallback: true }
  }

  const avg1 = avgRanking(p1Ranks)!
  const avg2 = avgRanking(p2Ranks)!

  // Strength: lower ranking = stronger. Use log so the gap between #1 and
  // #10 is much bigger than between #200 and #210 (ranking is ordinal,
  // not interval).
  const strength1 = Math.log(1 / avg1)
  const strength2 = Math.log(1 / avg2)
  const diff = strength1 - strength2

  // Scale factor — tuned so a 10-rank gap (1 vs 11) gives ~0.65 favored,
  // a 50-rank gap (1 vs 51) gives ~0.78. Conservative on purpose.
  const SCALE = 1.5

  const p1Raw = sigmoid(diff * SCALE)
  const p1Clamped = clamp(p1Raw, PROB_CLAMP_MIN, PROB_CLAMP_MAX)

  return {
    p1: p1Clamped,
    p2: 1 - p1Clamped,
    isFallback: false,
  }
}

/** Inverse-probability multiplier with margin bonus. */
export function computeMultiplier(probability: number, marginCorrect: boolean): number {
  const safeP = clamp(probability, 0.0001, 1)
  const base = clamp(
    Math.round((1 / safeP) * 100) / 100,
    MULTIPLIER_FLOOR,
    MULTIPLIER_CAP,
  )
  return marginCorrect ? base + MARGIN_BONUS : base
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/predictions/probability.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/predictions/probability.ts src/lib/__tests__/predictions/probability.test.ts
git commit -m "feat(predictions): probability + multiplier with tests"
```

---

### Task 3: Result classification + reward (TDD)

**Files:**
- Create: `src/lib/predictions/scoring.ts`
- Create: `src/lib/__tests__/predictions/scoring.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/predictions/scoring.test.ts
import { describe, it, expect } from 'vitest'
import { classifyResult, computeReward, getMarginFromMatch } from '@/lib/predictions/scoring'
import { STAKE_GUACAS, HEAVY_UPSET_THRESHOLD } from '@/lib/predictions/constants'
import type { Prediction } from '@/lib/predictions/types'
import type { Match } from '@/types/match'

function mockFinishedMatch(opts: {
  status?: string
  winner?: 1 | 2
  sets?: { p1: number; p2: number }[]
}): Match {
  return {
    id: 'm',
    status: opts.status ?? 'finished',
    winner_pair: opts.winner ?? null,
    sets: (opts.sets ?? []).map((s, i) => ({
      id: `s${i}`,
      set_number: i + 1,
      pair1_games: s.p1,
      pair2_games: s.p2,
    })),
  } as any
}

const basePrediction: Prediction = {
  matchId: 'm',
  pair: 1,
  margin: '2-0',
  probability: 0.50,
  multiplier: 2.00,
  isFallback: false,
  createdAt: '2026-01-01T00:00:00Z',
}

describe('classifyResult', () => {
  it('returns invalidated for walkover/retired/cancelled matches', () => {
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'walkover' }))).toBe('invalidated')
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'retired' }))).toBe('invalidated')
  })

  it('returns wrong when the user picked the loser', () => {
    const m = mockFinishedMatch({ winner: 2, sets: [{ p1: 4, p2: 6 }, { p1: 4, p2: 6 }] })
    expect(classifyResult({ ...basePrediction, pair: 1 }, m)).toBe('wrong')
  })

  it('returns right when pair correct but margin off', () => {
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 6, p2: 3 }] })
    expect(classifyResult({ ...basePrediction, pair: 1, margin: '2-0' }, m)).toBe('right')
  })

  it('returns perfect when pair + margin both correct (prob > heavy-upset threshold)', () => {
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }] })
    expect(classifyResult({ ...basePrediction, pair: 1, margin: '2-0', probability: 0.6 }, m)).toBe('perfect')
  })

  it('returns upset when user picked underdog winner with prob ≤ 0.25 (precedence over perfect)', () => {
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }] })
    // Even with margin perfect, it's still UPSET because prob ≤ threshold
    expect(classifyResult({ ...basePrediction, pair: 1, margin: '2-0', probability: 0.20 }, m)).toBe('upset')
    expect(classifyResult({ ...basePrediction, pair: 1, margin: '2-0', probability: HEAVY_UPSET_THRESHOLD }, m)).toBe('upset')
  })

  it('returns null when match not yet finished', () => {
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'scheduled' }))).toBe(null)
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'live' }))).toBe(null)
  })
})

describe('getMarginFromMatch', () => {
  it('returns 2-0 when winner takes both sets', () => {
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }] })
    expect(getMarginFromMatch(m, 1)).toBe('2-0')
  })

  it('returns 2-1 when winner takes 3 sets', () => {
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 6, p2: 3 }] })
    expect(getMarginFromMatch(m, 1)).toBe('2-1')
  })

  it('returns null when match has no resolvable sets', () => {
    expect(getMarginFromMatch(mockFinishedMatch({ winner: 1 }), 1)).toBe(null)
  })
})

describe('computeReward', () => {
  it('returns 0 for wrong picks', () => {
    expect(computeReward({ ...basePrediction, multiplier: 3.0 }, 'wrong', false)).toBe(0)
  })

  it('returns 0 for invalidated picks', () => {
    expect(computeReward({ ...basePrediction, multiplier: 3.0 }, 'invalidated', false)).toBe(0)
  })

  it('returns base multiplier × stake for "right" (no margin bonus)', () => {
    // 100 stake × 1.47 multiplier = 147
    expect(computeReward({ ...basePrediction, multiplier: 1.47 }, 'right', false)).toBe(147)
  })

  it('adds margin bonus for "perfect"', () => {
    // 100 × (1.47 + 0.50) = 197
    expect(computeReward({ ...basePrediction, multiplier: 1.47 }, 'perfect', true)).toBe(197)
  })

  it('caps base at 5.00 and bonus at 5.50 for upsets', () => {
    // 100 × (5.00 + 0.50) = 550
    expect(computeReward({ ...basePrediction, multiplier: 5.00 }, 'upset', true)).toBe(550)
  })

  it('upset without margin bonus is just base', () => {
    expect(computeReward({ ...basePrediction, multiplier: 3.13 }, 'upset', false)).toBe(313)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/predictions/scoring.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `scoring.ts`**

```ts
// src/lib/predictions/scoring.ts
//
// Reward + result classification. Pure functions over a stored prediction
// and the current match state.

import type { Match } from '@/types/match'
import { parseSetScore, parseSetFromGames } from '@/types/match'
import { STAKE_GUACAS, MARGIN_BONUS, HEAVY_UPSET_THRESHOLD } from './constants'
import type { Prediction, PredictionResult, Margin, Pair } from './types'

const FINISHED_STATUSES = ['finished', 'ended'] as const
const INVALIDATED_STATUSES = ['walkover', 'retired', 'cancelled'] as const

function isFinished(status: string | null | undefined): boolean {
  return FINISHED_STATUSES.includes(status as any)
}
function isInvalidated(status: string | null | undefined): boolean {
  return INVALIDATED_STATUSES.includes(status as any)
}

/** Resolve the actual margin (2-0 or 2-1) from a finished match's set scores. */
export function getMarginFromMatch(match: Match, winnerPair: Pair): Margin | null {
  const sets = (match.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
  if (sets.length < 2) return null

  let winnerSets = 0
  let loserSets = 0
  for (const s of sets) {
    const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
    const p1 = parsed?.p1 ?? s.pair1_games ?? 0
    const p2 = parsed?.p2 ?? s.pair2_games ?? 0
    if (p1 === p2) continue
    const winnerWonSet = winnerPair === 1 ? p1 > p2 : p2 > p1
    if (winnerWonSet) winnerSets++
    else loserSets++
  }
  if (winnerSets < 2) return null
  return loserSets === 0 ? '2-0' : '2-1'
}

/** Classify the result of a prediction against a finished match. Returns
 *  null when the match isn't resolvable yet. */
export function classifyResult(prediction: Prediction, match: Match): PredictionResult | null {
  const status = match.status as string | null | undefined

  if (isInvalidated(status)) return 'invalidated'
  if (!isFinished(status)) return null

  const winner = match.winner_pair as Pair | null | undefined
  if (!winner) return null

  const pickedPair = prediction.pair
  if (pickedPair !== winner) return 'wrong'

  // From here on, pair is correct.
  const actualMargin = getMarginFromMatch(match, winner)
  const marginCorrect = actualMargin !== null && actualMargin === prediction.margin

  // Heavy-upset framing: if the pair the user picked was at or below the
  // upset threshold, render as 'upset' regardless of margin correctness.
  // (Margin still affects the reward — see computeReward.)
  if (prediction.probability <= HEAVY_UPSET_THRESHOLD) return 'upset'

  return marginCorrect ? 'perfect' : 'right'
}

/** Convert classification + the prediction into a guacas reward. */
export function computeReward(
  prediction: Prediction,
  result: PredictionResult,
  marginCorrect: boolean,
): number {
  if (result === 'wrong' || result === 'invalidated') return 0

  const effectiveMultiplier =
    marginCorrect ? prediction.multiplier + MARGIN_BONUS : prediction.multiplier

  return Math.round(STAKE_GUACAS * effectiveMultiplier)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/predictions/scoring.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/predictions/scoring.ts src/lib/__tests__/predictions/scoring.test.ts
git commit -m "feat(predictions): result classification + reward computation"
```

---

### Task 4: Extend `useMatchPrediction` to store frozen multiplier

**Files:**
- Modify: `src/hooks/useMatchPrediction.ts`

The current hook stores `{ pair, margin }`. We need to also persist the frozen probability + multiplier so reward math is stable even if rankings later change. Storage shape changes; we migrate old records on read.

- [ ] **Step 1: Replace `src/hooks/useMatchPrediction.ts`**

```ts
'use client'

import { useState, useCallback } from 'react'
import type { Prediction, Pair, Margin } from '@/lib/predictions/types'

const STORAGE_KEY = 'pn_match_predictions'

/** Legacy shape we may find in localStorage from before the multiplier
 *  economy shipped. We migrate forward on read by treating these as
 *  toss-up fallbacks (probability 0.5, multiplier 2.0). */
type LegacyPrediction = { pair: Pair; margin: Margin }

function readAll(): Record<string, Prediction> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Prediction | LegacyPrediction>

    const migrated: Record<string, Prediction> = {}
    for (const [matchId, p] of Object.entries(parsed)) {
      if ('multiplier' in p && 'probability' in p) {
        migrated[matchId] = p as Prediction
      } else {
        // Legacy record — promote to toss-up so it remains usable.
        migrated[matchId] = {
          matchId,
          pair: (p as LegacyPrediction).pair,
          margin: (p as LegacyPrediction).margin,
          probability: 0.5,
          multiplier: 2.0,
          isFallback: true,
          createdAt: new Date(0).toISOString(),
        }
      }
    }
    return migrated
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, Prediction>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

export type SetPredictionInput = Omit<Prediction, 'matchId' | 'createdAt'>

export function useMatchPrediction(matchId: string) {
  const [prediction, setPredictionState] = useState<Prediction | null>(() => {
    return readAll()[matchId] ?? null
  })

  const setPrediction = useCallback(
    (p: SetPredictionInput) => {
      const all = readAll()
      const full: Prediction = {
        ...p,
        matchId,
        createdAt: new Date().toISOString(),
      }
      all[matchId] = full
      writeAll(all)
      setPredictionState(full)
    },
    [matchId],
  )

  const clearPrediction = useCallback(() => {
    const all = readAll()
    delete all[matchId]
    writeAll(all)
    setPredictionState(null)
  }, [matchId])

  return { prediction, setPrediction, clearPrediction }
}

/** Read all predictions across matches (used by /picks page). */
export function readAllPredictions(): Prediction[] {
  return Object.values(readAll())
}
```

- [ ] **Step 2: Verify nothing else imports the old `Prediction` shape**

```bash
rg "from '@/hooks/useMatchPrediction'" src/
```

Expected: only `PredictionSection.tsx` and `match/[id]/page.tsx` (which use `Prediction` as a type). They'll keep compiling because the new type is a superset of the old fields they read.

- [ ] **Step 3: Run TypeScript build**

```bash
npx tsc --noEmit
```

Expected: PASS (existing call sites still type-check because they only use `pair`/`margin`).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useMatchPrediction.ts
git commit -m "feat(predictions): persist frozen multiplier in localStorage prediction"
```

---

### Task 5: Add prediction.* i18n keys to all 5 locales

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add `prediction` key block to `en.json`**

Insert this block as a top-level sibling of `matches`, `tournament`, etc. Keep alphabetical order if the file follows it; otherwise append before the closing brace.

```json
"prediction": {
  "cta": {
    "pick": "PICK",
    "yourPick": "YOUR PICK",
    "locked": "PICKS LOCKED"
  },
  "makeYourPick": "Make your pick",
  "rewardShown": "Reward shown",
  "favored": "{pct}% favored",
  "underdog": "{pct}% underdog",
  "tossUp": "{pct}% toss-up",
  "unrankedTossUp": "Unranked — toss-up",
  "upsetFlag": "UPSET",
  "ifRight": "guacas if right",
  "marginBonus": "+0.50× bonus if you nail the margin",
  "youArePicking": "You're picking",
  "change": "Change",
  "lockedIn": "Locked in",
  "tapToClose": "Tap to close",
  "closingSoon": "Closing in a moment…",
  "stayOpen": "Stay open",
  "straightSets": "Straight sets",
  "threeSets": "Three sets",
  "result": {
    "perfect": "Perfect call",
    "right": "Right · margin off",
    "wrong": "Wrong",
    "heavyUpset": "Heavy upset called",
    "perfectBadge": "PERFECT",
    "rightBadge": "RIGHT",
    "wrongBadge": "WRONG",
    "upsetBadge": "UPSET"
  },
  "live": {
    "tracking": "Tracking your pick",
    "yourPickHeader": "Your pick"
  },
  "community": {
    "pick": "Community pick",
    "picks": "{n, plural, one {# pick} other {# picks}}",
    "noPicksYet": "Be the first to pick"
  },
  "stats": {
    "avgRanking": "avg ranking",
    "lastFive": "last 5",
    "h2h": "h2h"
  },
  "sponsor": "Predictions · presented by {brand}",
  "myPicks": {
    "title": "My picks",
    "totalGuacas": "total guacas",
    "accuracy": "accuracy",
    "currentStreak": "streak",
    "bestStreak": "best streak",
    "rank": "RANK #{rank} · GLOBAL",
    "filterAll": "All",
    "filterPending": "Pending",
    "filterWon": "Won",
    "filterLost": "Lost",
    "noPicks": "You haven't picked any matches yet",
    "noPicksSub": "Tap PICK on any scheduled match to play."
  }
}
```

- [ ] **Step 2: Add the same `prediction` block to es.json (Spanish)**

```json
"prediction": {
  "cta": { "pick": "ELIGE", "yourPick": "TU ELECCIÓN", "locked": "BLOQUEADO" },
  "makeYourPick": "Haz tu elección",
  "rewardShown": "Recompensa mostrada",
  "favored": "{pct}% favorito",
  "underdog": "{pct}% no favorito",
  "tossUp": "{pct}% incierto",
  "unrankedTossUp": "Sin ranking — incierto",
  "upsetFlag": "SORPRESA",
  "ifRight": "guacas si aciertas",
  "marginBonus": "+0,50× extra si aciertas el marcador",
  "youArePicking": "Estás eligiendo",
  "change": "Cambiar",
  "lockedIn": "Confirmado",
  "tapToClose": "Toca para cerrar",
  "closingSoon": "Cerrando en un momento…",
  "stayOpen": "Mantener abierto",
  "straightSets": "Sets directos",
  "threeSets": "Tres sets",
  "result": {
    "perfect": "Predicción perfecta",
    "right": "Acertado · marcador no",
    "wrong": "Fallaste",
    "heavyUpset": "Gran sorpresa acertada",
    "perfectBadge": "PERFECTO",
    "rightBadge": "ACIERTO",
    "wrongBadge": "FALLO",
    "upsetBadge": "SORPRESA"
  },
  "live": { "tracking": "Siguiendo tu elección", "yourPickHeader": "Tu elección" },
  "community": {
    "pick": "Elección de la comunidad",
    "picks": "{n, plural, one {# elección} other {# elecciones}}",
    "noPicksYet": "Sé el primero en elegir"
  },
  "stats": { "avgRanking": "ranking medio", "lastFive": "últimos 5", "h2h": "h2h" },
  "sponsor": "Predicciones · presentado por {brand}",
  "myPicks": {
    "title": "Mis elecciones",
    "totalGuacas": "guacas totales",
    "accuracy": "precisión",
    "currentStreak": "racha",
    "bestStreak": "mejor racha",
    "rank": "PUESTO #{rank} · GLOBAL",
    "filterAll": "Todas",
    "filterPending": "Pendientes",
    "filterWon": "Ganadas",
    "filterLost": "Perdidas",
    "noPicks": "Aún no has elegido ningún partido",
    "noPicksSub": "Toca ELIGE en cualquier partido programado para jugar."
  }
}
```

- [ ] **Step 3: Add the `prediction` block to pt.json (Portuguese)**

```json
"prediction": {
  "cta": { "pick": "ESCOLHE", "yourPick": "TUA ESCOLHA", "locked": "BLOQUEADO" },
  "makeYourPick": "Faz a tua escolha",
  "rewardShown": "Recompensa mostrada",
  "favored": "{pct}% favorito",
  "underdog": "{pct}% azarão",
  "tossUp": "{pct}% incerto",
  "unrankedTossUp": "Sem ranking — incerto",
  "upsetFlag": "SURPRESA",
  "ifRight": "guacas se acertares",
  "marginBonus": "+0,50× extra se acertares o resultado",
  "youArePicking": "Estás a escolher",
  "change": "Mudar",
  "lockedIn": "Confirmado",
  "tapToClose": "Toca para fechar",
  "closingSoon": "A fechar num instante…",
  "stayOpen": "Manter aberto",
  "straightSets": "Sets diretos",
  "threeSets": "Três sets",
  "result": {
    "perfect": "Previsão perfeita",
    "right": "Acertaste · resultado não",
    "wrong": "Falhaste",
    "heavyUpset": "Grande surpresa acertada",
    "perfectBadge": "PERFEITO",
    "rightBadge": "CERTO",
    "wrongBadge": "ERRADO",
    "upsetBadge": "SURPRESA"
  },
  "live": { "tracking": "A seguir a tua escolha", "yourPickHeader": "A tua escolha" },
  "community": {
    "pick": "Escolha da comunidade",
    "picks": "{n, plural, one {# escolha} other {# escolhas}}",
    "noPicksYet": "Sê o primeiro a escolher"
  },
  "stats": { "avgRanking": "ranking médio", "lastFive": "últimos 5", "h2h": "h2h" },
  "sponsor": "Previsões · apresentado por {brand}",
  "myPicks": {
    "title": "Minhas escolhas",
    "totalGuacas": "guacas totais",
    "accuracy": "precisão",
    "currentStreak": "sequência",
    "bestStreak": "melhor sequência",
    "rank": "POSIÇÃO #{rank} · GLOBAL",
    "filterAll": "Todas",
    "filterPending": "Pendentes",
    "filterWon": "Ganhas",
    "filterLost": "Perdidas",
    "noPicks": "Ainda não escolheste nenhum jogo",
    "noPicksSub": "Toca em ESCOLHE em qualquer jogo agendado para jogar."
  }
}
```

- [ ] **Step 4: Add the `prediction` block to it.json (Italian)**

```json
"prediction": {
  "cta": { "pick": "SCEGLI", "yourPick": "LA TUA SCELTA", "locked": "BLOCCATO" },
  "makeYourPick": "Fai la tua scelta",
  "rewardShown": "Premio mostrato",
  "favored": "{pct}% favorito",
  "underdog": "{pct}% sfavorito",
  "tossUp": "{pct}% incerto",
  "unrankedTossUp": "Senza ranking — incerto",
  "upsetFlag": "SORPRESA",
  "ifRight": "guacas se indovini",
  "marginBonus": "+0,50× bonus se indovini il risultato",
  "youArePicking": "Stai scegliendo",
  "change": "Cambia",
  "lockedIn": "Confermato",
  "tapToClose": "Tocca per chiudere",
  "closingSoon": "Chiudo tra un attimo…",
  "stayOpen": "Tieni aperto",
  "straightSets": "Set diretti",
  "threeSets": "Tre set",
  "result": {
    "perfect": "Pronostico perfetto",
    "right": "Giusto · risultato no",
    "wrong": "Sbagliato",
    "heavyUpset": "Grande sorpresa azzeccata",
    "perfectBadge": "PERFETTO",
    "rightBadge": "GIUSTO",
    "wrongBadge": "SBAGLIATO",
    "upsetBadge": "SORPRESA"
  },
  "live": { "tracking": "Seguendo la tua scelta", "yourPickHeader": "La tua scelta" },
  "community": {
    "pick": "Scelta della community",
    "picks": "{n, plural, one {# scelta} other {# scelte}}",
    "noPicksYet": "Sii il primo a scegliere"
  },
  "stats": { "avgRanking": "ranking medio", "lastFive": "ultime 5", "h2h": "h2h" },
  "sponsor": "Pronostici · presentato da {brand}",
  "myPicks": {
    "title": "Le mie scelte",
    "totalGuacas": "guacas totali",
    "accuracy": "precisione",
    "currentStreak": "serie",
    "bestStreak": "miglior serie",
    "rank": "POSIZIONE #{rank} · GLOBALE",
    "filterAll": "Tutte",
    "filterPending": "In sospeso",
    "filterWon": "Vinte",
    "filterLost": "Perse",
    "noPicks": "Non hai ancora scelto nessuna partita",
    "noPicksSub": "Tocca SCEGLI su qualsiasi partita programmata per giocare."
  }
}
```

- [ ] **Step 5: Add the `prediction` block to fr.json (French)**

```json
"prediction": {
  "cta": { "pick": "CHOISIR", "yourPick": "TON CHOIX", "locked": "VERROUILLÉ" },
  "makeYourPick": "Fais ton choix",
  "rewardShown": "Récompense affichée",
  "favored": "{pct}% favori",
  "underdog": "{pct}% outsider",
  "tossUp": "{pct}% indécis",
  "unrankedTossUp": "Sans classement — indécis",
  "upsetFlag": "SURPRISE",
  "ifRight": "guacas si tu gagnes",
  "marginBonus": "+0,50× bonus si tu trouves le score",
  "youArePicking": "Tu choisis",
  "change": "Changer",
  "lockedIn": "Validé",
  "tapToClose": "Touche pour fermer",
  "closingSoon": "Fermeture imminente…",
  "stayOpen": "Garder ouvert",
  "straightSets": "Sets directs",
  "threeSets": "Trois sets",
  "result": {
    "perfect": "Pronostic parfait",
    "right": "Bon · score raté",
    "wrong": "Raté",
    "heavyUpset": "Grosse surprise réussie",
    "perfectBadge": "PARFAIT",
    "rightBadge": "BON",
    "wrongBadge": "RATÉ",
    "upsetBadge": "SURPRISE"
  },
  "live": { "tracking": "Suivi de ton choix", "yourPickHeader": "Ton choix" },
  "community": {
    "pick": "Choix de la communauté",
    "picks": "{n, plural, one {# choix} other {# choix}}",
    "noPicksYet": "Sois le premier à choisir"
  },
  "stats": { "avgRanking": "classement moyen", "lastFive": "5 derniers", "h2h": "h2h" },
  "sponsor": "Pronostics · présenté par {brand}",
  "myPicks": {
    "title": "Mes choix",
    "totalGuacas": "guacas totaux",
    "accuracy": "précision",
    "currentStreak": "série",
    "bestStreak": "meilleure série",
    "rank": "RANG #{rank} · GLOBAL",
    "filterAll": "Tous",
    "filterPending": "En attente",
    "filterWon": "Gagnés",
    "filterLost": "Perdus",
    "noPicks": "Tu n'as encore choisi aucun match",
    "noPicksSub": "Touche CHOISIR sur n'importe quel match programmé pour jouer."
  }
}
```

- [ ] **Step 6: Verify next-intl picks up the new namespace**

```bash
npx tsc --noEmit
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/messages/
git commit -m "feat(i18n): prediction.* keys for all five locales"
```

---

### Task 6: `<PredictionFlow>` component (pair-pick → margin-pick → confirmed)

**Files:**
- Create: `src/components/prediction/PredictionFlow.tsx`

This is the action zone. It runs through three internal states (`pick`, `margin`, `done`) and reads/writes via the `useMatchPrediction` hook. Used by both inline card and match-detail page.

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { pairName } from '@/types/match'
import {
  computeMatchProbability,
  computeMultiplier,
} from '@/lib/predictions/probability'
import { HEAVY_UPSET_THRESHOLD, STAKE_GUACAS } from '@/lib/predictions/constants'
import type { Pair, Margin, Prediction } from '@/lib/predictions/types'

const PAIR1_COLOR = '#FF6B2B'
const PAIR2_COLOR = '#FFD166'
const GREEN = '#7ED321'
const MUTED = '#6B7280'

const CHUNKY_BTN = 'polygon(2% 5%, 98% 0%, 100% 95%, 0% 100%)'
const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'

type Step = 'pick' | 'margin' | 'done'

export interface PredictionFlowProps {
  match: Match
  prediction: Prediction | null
  onLockIn: (p: { pair: Pair; margin: Margin; probability: number; multiplier: number; isFallback: boolean }) => void
  onClear: () => void
  /** Called after the user locks in the margin. Parent can use this to trigger
   *  auto-collapse 1.4s later. */
  onLocked?: () => void
}

function GuacaIcon({ size = 12 }: { size?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: '50%',
        background: GREEN, color: '#0a0a0a',
        fontSize: size * 0.62, fontWeight: 900, lineHeight: 1,
      }}
      aria-label="guacas"
    >G</span>
  )
}

export function PredictionFlow({ match, prediction, onLockIn, onClear, onLocked }: PredictionFlowProps) {
  const t = useTranslations('prediction')
  const [step, setStep] = useState<Step>(prediction ? 'done' : 'pick')
  const [selectedPair, setSelectedPair] = useState<Pair | null>(prediction?.pair ?? null)

  const prob = computeMatchProbability(match)
  const m1 = computeMultiplier(prob.p1, false)
  const m2 = computeMultiplier(prob.p2, false)
  const reward1 = Math.round(STAKE_GUACAS * m1)
  const reward2 = Math.round(STAKE_GUACAS * m2)

  // Re-sync if a parent passes a freshly-cleared prediction.
  useEffect(() => {
    if (!prediction && step === 'done') setStep('pick')
  }, [prediction, step])

  const handlePickPair = useCallback((p: Pair) => {
    setSelectedPair(p)
    setStep('margin')
  }, [])

  const handlePickMargin = useCallback((margin: Margin) => {
    if (!selectedPair) return
    const chosenP = selectedPair === 1 ? prob.p1 : prob.p2
    const chosenM = selectedPair === 1 ? m1 : m2
    onLockIn({
      pair: selectedPair,
      margin,
      probability: chosenP,
      multiplier: chosenM,
      isFallback: prob.isFallback,
    })
    setStep('done')
    onLocked?.()
  }, [selectedPair, prob, m1, m2, onLockIn, onLocked])

  const handleChange = useCallback(() => {
    onClear()
    setSelectedPair(null)
    setStep('pick')
  }, [onClear])

  const p1Name = pairName(match.pair1_player1, match.pair1_player2)
  const p2Name = pairName(match.pair2_player1, match.pair2_player2)
  const shortP1 = p1Name.split(' / ').map(n => n.split(' ').slice(-1)[0]).join(' / ')
  const shortP2 = p2Name.split(' / ').map(n => n.split(' ').slice(-1)[0]).join(' / ')

  if (step === 'done' && prediction) {
    return (
      <div style={{
        background: 'rgba(126,211,33,0.10)', border: '0.5px solid rgba(126,211,33,0.25)',
        padding: 12, marginBottom: 12,
        clipPath: 'polygon(1% 5%, 99% 0%, 100% 95%, 0% 100%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', background: GREEN, color: '#0a0a0a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, flexShrink: 0,
          }}>✓</div>
          <div>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: GREEN, fontWeight: 800 }}>
              {t('lockedIn')}
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
              {prediction.pair === 1 ? p1Name : p2Name} · {prediction.margin}
            </div>
          </div>
          <button
            onClick={handleChange}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 0,
              fontSize: 10, fontWeight: 700, color: MUTED,
              textDecoration: 'underline', cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}
          >{t('change')}</button>
        </div>
      </div>
    )
  }

  if (step === 'margin' && selectedPair) {
    const chosenName = selectedPair === 1 ? p1Name : p2Name
    const chosenReward = selectedPair === 1 ? reward1 : reward2
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <div style={{
          background: 'rgba(126,211,33,0.06)', border: '0.5px solid rgba(126,211,33,0.18)',
          padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, color: GREEN, clipPath: CHUNKY_BAR,
        }}>
          <span>{t('youArePicking')}</span>
          <span style={{ fontWeight: 800, flex: 1 }}>{chosenName}</span>
          <span style={{ fontWeight: 800, color: '#FFD166', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {chosenReward} <GuacaIcon size={10} />
          </span>
          <button
            onClick={handleChange}
            style={{ background: 'transparent', border: 0, fontSize: 10, color: MUTED, textDecoration: 'underline', cursor: 'pointer', marginLeft: 8 }}
          >{t('change')}</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['2-0', '2-1'] as const).map(margin => (
            <button
              key={margin}
              onClick={() => handlePickMargin(margin)}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '12px 8px', cursor: 'pointer', textAlign: 'center',
                clipPath: CHUNKY_BTN, color: '#fff',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{margin.replace('-', ' – ')}</div>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: MUTED, textTransform: 'uppercase', marginTop: 2 }}>
                {margin === '2-0' ? t('straightSets') : t('threeSets')}
              </div>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#FFD166', marginTop: 4 }}>
                +0.50× bonus
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // step === 'pick'
  const fmtPct = (p: number) => `${Math.round(p * 100)}%`
  const isUpset1 = prob.p1 <= HEAVY_UPSET_THRESHOLD
  const isUpset2 = prob.p2 <= HEAVY_UPSET_THRESHOLD

  const pairButton = (pair: Pair, color: string, name: string, p: number, mult: number, reward: number, isUpset: boolean) => {
    const probLabel = prob.isFallback
      ? t('unrankedTossUp')
      : p > 0.55 ? t('favored', { pct: Math.round(p * 100) })
      : p < 0.45 ? t('underdog', { pct: Math.round(p * 100) })
      : t('tossUp', { pct: Math.round(p * 100) })
    return (
      <button
        onClick={() => handlePickPair(pair)}
        style={{
          flex: 1, minWidth: 0, position: 'relative',
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${color}55`,
          padding: '10px 8px 12px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          clipPath: CHUNKY_BTN, color: '#fff',
        }}
      >
        {isUpset && (
          <span style={{
            position: 'absolute', top: -7, right: -4,
            background: 'linear-gradient(135deg, #FF6B2B, #FFD166)',
            color: '#0a0a0a', fontSize: 7, fontWeight: 800, letterSpacing: 0.5,
            padding: '3px 6px', textTransform: 'uppercase',
            clipPath: 'polygon(8% 0%, 100% 0%, 92% 100%, 0% 100%)',
          }}>{t('upsetFlag')}</span>
        )}
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color }}>
          PAIR {pair}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center', lineHeight: 1.25 }}>{name}</span>
        <div style={{
          borderTop: '0.5px dashed rgba(255,255,255,0.10)',
          paddingTop: 7, marginTop: 4, width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {probLabel}
          </span>
          <span style={{
            fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            lineHeight: 1, letterSpacing: -0.5,
            color: p < 0.40 ? '#FF6B2B' : p < 0.55 ? '#FFD166' : GREEN,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {reward} <GuacaIcon size={16} />
          </span>
          <span style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 }}>
            {t('ifRight')}
          </span>
        </div>
      </button>
    )
  }

  return (
    <>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.7, color: MUTED, textTransform: 'uppercase', textAlign: 'center', marginBottom: 8 }}>
        {t('makeYourPick')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {pairButton(1, PAIR1_COLOR, shortP1, prob.p1, m1, reward1, isUpset1)}
        {pairButton(2, PAIR2_COLOR, shortP2, prob.p2, m2, reward2, isUpset2)}
      </div>
      <p style={{ textAlign: 'center', color: MUTED, fontSize: 10, margin: 0 }}>
        {t('marginBonus')}
      </p>
    </>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/prediction/PredictionFlow.tsx
git commit -m "feat(predictions): PredictionFlow component (pair → margin → confirmed)"
```

---

### Task 7: `<PredictionPanel>` component (full expanded panel)

**Files:**
- Create: `src/components/prediction/PredictionPanel.tsx`

Wraps `PredictionFlow` plus the analytics block (probability bar, stats grid, community pick band, sponsor line). Handles the four panel modes: `prePick` (default), `live`, `finished`, `lockedNoPick`.

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { computeMatchProbability } from '@/lib/predictions/probability'
import { classifyResult, computeReward, getMarginFromMatch } from '@/lib/predictions/scoring'
import { STAKE_GUACAS } from '@/lib/predictions/constants'
import type { Prediction, Pair } from '@/lib/predictions/types'
import { useMatchPrediction } from '@/hooks/useMatchPrediction'
import { PredictionFlow } from './PredictionFlow'

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const PAIR1_BG = 'rgba(255,107,43,0.08)'

const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'
const CHUNKY_TILE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

type PanelMode = 'prePick' | 'live' | 'finished' | 'lockedNoPick'

export interface PredictionPanelProps {
  match: Match
  /** Optional sponsor brand name. Empty in v1. */
  sponsorBrand?: string | null
  /** Auto-collapse callback fired ~1.4s after the user locks in. */
  onLocked?: () => void
}

function GuacaIcon({ size = 12 }: { size?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: '50%',
        background: GREEN, color: '#0a0a0a',
        fontSize: size * 0.62, fontWeight: 900, lineHeight: 1,
      }}
    >G</span>
  )
}

function deriveMode(match: Match, prediction: Prediction | null): PanelMode {
  const status = match.status as string
  if (['finished', 'ended', 'walkover', 'retired'].includes(status)) return 'finished'
  if (status === 'live' || status === 'on_court') return prediction ? 'live' : 'lockedNoPick'
  return 'prePick'
}

export function PredictionPanel({ match, sponsorBrand, onLocked }: PredictionPanelProps) {
  const t = useTranslations('prediction')
  const { prediction, setPrediction, clearPrediction } = useMatchPrediction(match.id)
  const mode = deriveMode(match, prediction)
  const prob = computeMatchProbability(match)

  const renderProbBar = () => {
    if (prob.isFallback) return null
    const p1Pct = Math.round(prob.p1 * 100)
    const p2Pct = 100 - p1Pct
    const leftIsBigger = prob.p1 >= prob.p2
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
          <span style={{ color: leftIsBigger ? GREEN : MUTED }}>{p1Pct}%</span>
          <span style={{ color: !leftIsBigger ? GREEN : MUTED }}>{p2Pct}%</span>
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', clipPath: CHUNKY_BAR, marginBottom: 12 }}>
          <div style={{ height: '100%', width: `${p1Pct}%`, background: 'linear-gradient(90deg, #7ED321, #5fb314)' }} />
        </div>
      </>
    )
  }

  const renderStatsTile = (value: string, label: string) => (
    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '7px 6px', textAlign: 'center', clipPath: CHUNKY_TILE }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.5, color: MUTED, marginTop: 2, fontWeight: 700 }}>{label}</div>
    </div>
  )

  const avgRank1 = (() => {
    const rs = [match.pair1_player1?.ranking, match.pair1_player2?.ranking].filter((r): r is number => typeof r === 'number')
    return rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null
  })()
  const avgRank2 = (() => {
    const rs = [match.pair2_player1?.ranking, match.pair2_player2?.ranking].filter((r): r is number => typeof r === 'number')
    return rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null
  })()
  const avgRankLabel = (avgRank1 != null && avgRank2 != null) ? `#${avgRank1} vs #${avgRank2}` : '—'

  const renderResultBlock = () => {
    if (!prediction) return null
    const result = classifyResult(prediction, match)
    if (!result) return null
    const actualMargin = match.winner_pair ? getMarginFromMatch(match, match.winner_pair as Pair) : null
    const marginCorrect = actualMargin === prediction.margin
    const reward = computeReward(prediction, result, marginCorrect)

    const labelKey =
      result === 'perfect' ? 'result.perfect'
      : result === 'right' ? 'result.right'
      : result === 'wrong' ? 'result.wrong'
      : result === 'upset' ? 'result.heavyUpset'
      : null
    if (!labelKey) return null

    const isPositive = result === 'perfect' || result === 'right' || result === 'upset'
    const isUpset = result === 'upset'
    const bg = isUpset
      ? 'linear-gradient(90deg, rgba(255,107,43,0.10), rgba(255,209,102,0.10))'
      : isPositive ? 'rgba(126,211,33,0.10)' : 'rgba(255,70,85,0.08)'
    const border = isUpset
      ? '0.5px solid rgba(255,209,102,0.25)'
      : isPositive ? '0.5px solid rgba(126,211,33,0.22)' : '0.5px solid rgba(255,70,85,0.18)'
    const rewardColor = isUpset ? '#FFD166' : isPositive ? GREEN : '#FF4655'
    const ico = isUpset ? '🔥' : result === 'perfect' ? '🎯' : isPositive ? '✓' : '✗'

    return (
      <div style={{
        padding: '10px 12px', marginBottom: 12,
        background: bg, border, clipPath: 'polygon(1% 5%, 99% 0%, 100% 95%, 0% 100%)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 800, flexShrink: 0,
          background: isPositive ? (isUpset ? 'linear-gradient(135deg, #FF6B2B, #FFD166)' : GREEN) : 'rgba(255,70,85,0.2)',
          color: isPositive ? '#0a0a0a' : '#FF4655',
        }}>{ico}</div>
        <div>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 800, color: rewardColor }}>
            {t(labelKey as any)}
          </div>
          <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, lineHeight: 1.3, marginTop: 1 }}>
            {prediction.pair === 1
              ? match.pair1_player1?.name : match.pair2_player1?.name} · {prediction.margin}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5, color: rewardColor, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          +{reward} <GuacaIcon size={16} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 8 }}>
      {mode === 'prePick' && (
        <PredictionFlow
          match={match}
          prediction={prediction}
          onLockIn={(p) => setPrediction(p)}
          onClear={clearPrediction}
          onLocked={onLocked}
        />
      )}

      {mode === 'live' && prediction && (
        <div style={{
          background: 'rgba(126,211,33,0.08)',
          border: '0.5px solid rgba(126,211,33,0.18)',
          padding: '10px 12px', marginBottom: 12,
          clipPath: 'polygon(1% 5%, 99% 0%, 100% 95%, 0% 100%)',
        }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: GREEN, fontWeight: 800 }}>
            {t('live.yourPickHeader')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>
            {prediction.pair === 1
              ? match.pair1_player1?.name : match.pair2_player1?.name} · {prediction.margin}
          </div>
        </div>
      )}

      {mode === 'finished' && renderResultBlock()}

      {renderProbBar()}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
        {renderStatsTile(avgRankLabel, t('stats.avgRanking'))}
        {renderStatsTile('—', t('stats.lastFive'))}
        {renderStatsTile('—', t('stats.h2h'))}
      </div>

      {sponsorBrand ? (
        <div style={{ textAlign: 'center', fontSize: 8, color: MUTED, marginTop: 9, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
          {t('sponsor', { brand: sponsorBrand })}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/prediction/PredictionPanel.tsx
git commit -m "feat(predictions): PredictionPanel — full expanded panel"
```

---

### Task 8: Refactor `MatchCard.tsx` — corner state machine

**Files:**
- Modify: `src/components/MatchCard.tsx`

The card needs four corner states: `PICK` button (scheduled, no pick), `YOUR PICK` pill (predicted), `PICKS LOCKED` chip (live, no pick), or a result badge (finished + predicted). The existing `PREDICTED` chip in the metadata row goes away.

Replace the metadata-row prediction chip + corner emptiness with these conditionally-rendered components.

- [ ] **Step 1: Add new corner-element renderers inside `MatchCard`**

Insert this block above the `return` statement, after `const borderColor = ...`:

```tsx
  // ── Hydration-safe prediction read (unified for all card states) ─────
  const [prediction, setPredictionLocal] = useState<Prediction | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pn_match_predictions')
      if (raw) {
        const all = JSON.parse(raw)
        const p = all[match.id]
        if (p && 'multiplier' in p) setPredictionLocal(p as Prediction)
        else if (p) setPredictionLocal({
          matchId: match.id, pair: p.pair, margin: p.margin,
          probability: 0.5, multiplier: 2.0, isFallback: true,
          createdAt: new Date(0).toISOString(),
        })
      }
    } catch {}
  }, [match.id])

  // Card-open state for the inline prediction panel.
  const [isOpen, setIsOpen] = useState(false)
  const closeTimer = useRef<NodeJS.Timeout | null>(null)

  const toggleOpen = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault()
    setIsOpen(o => !o)
  }, [])

  const handleLocked = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setIsOpen(false), 1400)
  }, [])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
```

Add the missing imports at the top of the file:

```tsx
import { useEffect, useState, useRef, useCallback } from 'react'
import type { Prediction } from '@/lib/predictions/types'
import { classifyResult } from '@/lib/predictions/scoring'
import { PredictionPanel } from '@/components/prediction/PredictionPanel'
import { CHUNKY as PRED_CHUNKY } from '@/lib/predictions/constants'  // see note
```

(There's no `CHUNKY` export from `constants.ts` yet — the existing `CHUNKY` const inside `MatchCard.tsx` stays as-is. Skip the last import.)

- [ ] **Step 2: Replace the existing `hasPrediction` chip block with corner-state rendering**

Find this block (around line 273 in the existing file):

```tsx
{hasPrediction && isScheduled && (
  <span style={{ ... }}>...</span>
)}
```

Delete it (the corner now lives outside the metadata chip row).

Then, **immediately after the closing `</div>` of the chip metadata row** (around line 288), insert the corner element render:

```tsx
        {/* Corner CTA / pill / badge — state machine */}
        <CornerElement
          match={match}
          prediction={prediction}
          isLive={isLive}
          isFinished={isFinished}
          isOpen={isOpen}
          onToggle={toggleOpen}
          tPred={tPred}
        />
```

Add this `CornerElement` component definition at the bottom of the file (after `Chip` helper):

```tsx
function CornerElement({
  match, prediction, isLive, isFinished, isOpen, onToggle, tPred,
}: {
  match: Match
  prediction: Prediction | null
  isLive: boolean
  isFinished: boolean
  isOpen: boolean
  onToggle: (e?: React.MouseEvent) => void
  tPred: ReturnType<typeof useTranslations>
}) {
  const isScheduled = match.status === 'scheduled'

  // Finished + predicted → result badge
  if (isFinished && prediction) {
    const result = classifyResult(prediction, match)
    if (!result || result === 'invalidated') return null
    const isUpset = result === 'upset'
    const isPositive = result === 'perfect' || result === 'right' || result === 'upset'
    const bg = isUpset
      ? 'linear-gradient(135deg, #7ED321, #FFD166)'
      : isPositive ? GREEN : 'rgba(255,70,85,0.14)'
    const color = isPositive ? '#0a0a0a' : '#FF4655'
    const labelKey =
      result === 'perfect' ? 'result.perfectBadge'
      : result === 'right' ? 'result.rightBadge'
      : result === 'upset' ? 'result.upsetBadge'
      : 'result.wrongBadge'
    return (
      <button
        onClick={onToggle}
        style={{
          position: 'absolute', top: 10, right: 12, zIndex: 3,
          background: bg, color, padding: '6px 10px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
          clipPath: CHUNKY.badge, border: 0,
        }}
        aria-label={tPred(labelKey)}
      >
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1 }}>
          {tPred(labelKey)}
        </span>
      </button>
    )
  }

  // Live + predicted → "YOUR PICK" pill (read-only state)
  if (isLive && prediction) {
    return (
      <button onClick={onToggle} style={cornerPillStyle('rgba(126,211,33,0.10)', GREEN)}>
        <span style={cornerTopStyle}>{tPred('cta.yourPick')}</span>
      </button>
    )
  }

  // Live + no prediction → muted LOCKED chip
  if (isLive && !prediction) {
    return (
      <button onClick={onToggle} style={cornerPillStyle('rgba(255,255,255,0.04)', MUTED, 'dashed')}>
        <span style={cornerTopStyle}>{tPred('cta.locked')}</span>
      </button>
    )
  }

  // Scheduled + predicted → quieter "YOUR PICK" pill
  if (isScheduled && prediction) {
    return (
      <button onClick={onToggle} style={cornerPillStyle('rgba(126,211,33,0.10)', GREEN)}>
        <span style={cornerTopStyle}>{tPred('cta.yourPick')}</span>
      </button>
    )
  }

  // Scheduled + no prediction → green PICK CTA
  if (isScheduled) {
    return (
      <button
        onClick={onToggle}
        style={{
          position: 'absolute', top: 10, right: 12, zIndex: 3,
          background: GREEN, color: '#0a0a0a',
          padding: '7px 14px', cursor: 'pointer', border: 0,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
          clipPath: CHUNKY.badge,
          boxShadow: '0 2px 6px rgba(126,211,33,0.18)',
          transform: isOpen ? 'scale(0.9)' : 'scale(1)',
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? 'none' : 'auto',
          transition: 'transform 200ms ease, opacity 200ms ease',
        }}
        aria-label={tPred('cta.pick')}
      >
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="10" r="8" /><path d="M8 18h8" /><path d="M7 21h10" />
        </svg>
        <span>{tPred('cta.pick')}</span>
      </button>
    )
  }

  return null
}

const cornerTopStyle: React.CSSProperties = {
  fontSize: 8, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1,
}

function cornerPillStyle(bg: string, color: string, borderStyle: 'solid' | 'dashed' = 'solid'): React.CSSProperties {
  return {
    position: 'absolute', top: 10, right: 12, zIndex: 3,
    background: bg, color, padding: '5px 10px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    clipPath: CHUNKY.badge,
    border: `0.5px ${borderStyle} ${color}40`,
  }
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(predictions): MatchCard corner state machine"
```

---

### Task 9: Add expandable insights panel to `MatchCard.tsx`

**Files:**
- Modify: `src/components/MatchCard.tsx`

- [ ] **Step 1: Wrap the entire card content in a non-Link container, then add the expansion**

Today the card is wrapped in `<Link href={\`/match/...\`}>`. The whole card navigates. We need to **stop the card body from navigating** when expanded — clicks should toggle, not navigate.

Replace the outer `<Link>` with a `<div>` and explicitly link only the player name area (or replace navigation behavior with a long-press or info icon — simpler: keep it a `<Link>` but stop propagation in the corner button and allow card body click only when not open). For minimum disruption: convert outer wrapper to a `<div>` and add a `<Link>` overlay just on the date/time column.

Actual change — replace the outer `<Link>` open tag and closing tag:

Find:
```tsx
<Link
  href={`/match/${match.id}`}
  locale={locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
  style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 8 }}
>
```

Replace with:
```tsx
<div
  onClick={(e) => {
    // Tap the card body → toggle expansion (mirrors Chrome MCP-style toggle).
    if ((e.target as HTMLElement).closest('button, a')) return
    toggleOpen()
  }}
  style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 8, cursor: 'pointer' }}
>
```

Find the matching `</Link>` and replace with `</div>`.

Add a small "open match" link inside (in the date/time column for scheduled, or wrapping the scores column for live/finished). For simplicity, keep navigation accessible via long-press on mobile — defer; for v1 the card body toggles, the expanded panel stays in place. (The match detail page is already linked from the time and chips area becomes navigation later.)

(If the user wants direct navigation back, defer to Phase 1.5 — tap-and-hold or a small "→" affordance.)

- [ ] **Step 2: Add the expandable panel below the existing pair-rows `<div>`**

Just before the final closing `</div>` of the card body, insert:

```tsx
        {/* Expandable insights panel — Guacas prediction game */}
        <div
          style={{
            maxHeight: isOpen ? 600 : 0,
            opacity: isOpen ? 1 : 0,
            overflow: 'hidden',
            marginTop: isOpen ? 12 : 0,
            paddingTop: isOpen ? 12 : 0,
            borderTop: isOpen ? `0.5px solid ${BORDER}` : '0.5px solid transparent',
            transition: 'max-height 380ms ease, opacity 280ms ease, margin-top 380ms ease, padding-top 380ms ease',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {isOpen && (
            <>
              <PredictionPanel match={match} onLocked={handleLocked} />
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  margin: '10px auto 0', padding: 8,
                  background: 'transparent', border: 0, cursor: 'pointer',
                  color: MUTED, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
                }}
              >
                <span style={{ fontSize: 11, lineHeight: 1 }}>▴</span>
                {tPred('tapToClose')}
                <span style={{ fontSize: 11, lineHeight: 1 }}>▴</span>
              </button>
            </>
          )}
        </div>
```

- [ ] **Step 3: Smoke test in dev preview**

```bash
npm run dev
```

Open `http://localhost:3002`, navigate to a matches list with a scheduled match.

- Tap the green PICK CTA → card expands with prediction zone.
- Tap a pair → margin step appears.
- Tap a margin → confirmation, auto-collapses 1.4s later.
- Re-open → corner now reads "YOUR PICK".
- Tap "Tap to close" → collapses.

- [ ] **Step 4: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(predictions): expandable insights panel on MatchCard"
```

---

### Task 10: Refactor `PredictionSection.tsx` to use `<PredictionPanel>`

**Files:**
- Modify: `src/app/[locale]/match/[id]/PredictionSection.tsx`

The match-detail page has its own prediction section (richer than the card). Replace its body with `<PredictionPanel>` so logic doesn't drift. Keep its callers unchanged.

- [ ] **Step 1: Replace `PredictionSection.tsx` body**

```tsx
'use client'

import { Match } from '@/types/match'
import { PredictionPanel } from '@/components/prediction/PredictionPanel'

export function PredictionSection({ match }: {
  match: Match
  pair1Label?: string
  pair2Label?: string
  prediction?: unknown
  predStep?: unknown
  setPredStep?: unknown
  setPrediction?: unknown
  clearPrediction?: unknown
}) {
  return (
    <div style={{ background: '#141414', borderBottom: '0.5px solid rgba(255,255,255,0.06)', padding: 16 }}>
      <PredictionPanel match={match} />
    </div>
  )
}

export function PredictionResult({ match }: { match: Match; prediction?: unknown; pair1Label?: string; pair2Label?: string }) {
  return <PredictionPanel match={match} />
}
```

(The unused props are kept on the type signature so existing call sites don't break. They'll be removed in a cleanup pass.)

- [ ] **Step 2: Run TypeScript build + smoke test the match detail page**

```bash
npx tsc --noEmit
npm run dev
```

Open a match detail page: predictions block should render the same flow.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/match/[id]/PredictionSection.tsx
git commit -m "refactor(predictions): match-detail PredictionSection delegates to PredictionPanel"
```

---

### Task 11: `/picks` page — stats header + filtered list

**Files:**
- Create: `src/app/[locale]/picks/page.tsx`
- Create: `src/app/[locale]/picks/StatsHeader.tsx`
- Create: `src/app/[locale]/picks/PicksList.tsx`

The page reads from localStorage in Phase 1, fetches matches in batch, computes results lazily.

- [ ] **Step 1: Create `StatsHeader.tsx`**

```tsx
'use client'

import { useTranslations } from 'next-intl'

const GREEN = '#7ED321'
const GOLD = '#FFD166'
const MUTED = '#6B7280'

const CHUNKY_TILE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export interface StatsHeaderProps {
  displayName: string
  rank: number | null
  totalGuacas: number
  accuracyPct: number
  currentStreak: number
  bestStreak: number
}

export function StatsHeader({ displayName, rank, totalGuacas, accuracyPct, currentStreak, bestStreak }: StatsHeaderProps) {
  const t = useTranslations('prediction.myPicks')

  const initial = displayName.charAt(0).toUpperCase()

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'linear-gradient(135deg, #FF6B2B, #FFD166)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#0a0a0a', flexShrink: 0,
        }}>{initial}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{displayName}</div>
          {rank != null && (
            <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
              {t('rank', { rank })}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
        <Tile value={totalGuacas.toLocaleString()} label={t('totalGuacas')} valueColor="#fff" />
        <Tile value={`${accuracyPct}%`} label={t('accuracy')} valueColor={GREEN} />
        <Tile value={String(currentStreak)} label={t('currentStreak')} valueColor={GOLD} />
        <Tile value={String(bestStreak)} label={t('bestStreak')} valueColor="#fff" />
      </div>
    </>
  )
}

function Tile({ value, label, valueColor }: { value: string; label: string; valueColor: string }) {
  return (
    <div style={{ background: '#141414', border: '0.5px solid rgba(255,255,255,0.06)', padding: '10px 8px', textAlign: 'center', clipPath: CHUNKY_TILE }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: valueColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.5, color: MUTED, marginTop: 5, fontWeight: 700 }}>{label}</div>
    </div>
  )
}
```

- [ ] **Step 2: Create `PicksList.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Match } from '@/types/match'
import type { Prediction, PredictionResult } from '@/lib/predictions/types'
import { classifyResult, computeReward, getMarginFromMatch } from '@/lib/predictions/scoring'

const GREEN = '#7ED321'
const GOLD = '#FFD166'
const MUTED = '#6B7280'
const RED = '#FF4655'

const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

type FilterKind = 'all' | 'pending' | 'won' | 'lost'

export interface PicksListProps {
  picks: Array<{ prediction: Prediction; match: Match }>
}

export function PicksList({ picks }: PicksListProps) {
  const t = useTranslations('prediction.myPicks')
  const [filter, setFilter] = useState<FilterKind>('all')

  const enriched = picks.map(({ prediction, match }) => {
    const result = classifyResult(prediction, match) // null when unresolved
    const actualMargin = match.winner_pair ? getMarginFromMatch(match, match.winner_pair as 1 | 2) : null
    const marginCorrect = actualMargin === prediction.margin
    const reward = result ? computeReward(prediction, result, marginCorrect) : null
    return { prediction, match, result, reward }
  }).sort((a, b) => new Date(b.prediction.createdAt).getTime() - new Date(a.prediction.createdAt).getTime())

  const counts = {
    all: enriched.length,
    pending: enriched.filter(e => e.result === null).length,
    won: enriched.filter(e => e.result === 'right' || e.result === 'perfect' || e.result === 'upset').length,
    lost: enriched.filter(e => e.result === 'wrong').length,
  }

  const filtered = enriched.filter(e => {
    if (filter === 'all') return true
    if (filter === 'pending') return e.result === null
    if (filter === 'won') return e.result === 'right' || e.result === 'perfect' || e.result === 'upset'
    if (filter === 'lost') return e.result === 'wrong'
    return false
  })

  if (enriched.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: MUTED }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 6 }}>{t('noPicks')}</div>
        <div style={{ fontSize: 12 }}>{t('noPicksSub')}</div>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
        {(['all', 'pending', 'won', 'lost'] as const).map(k => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
              background: filter === k ? GREEN : '#1A1A1A',
              color: filter === k ? '#0a0a0a' : MUTED,
              padding: '7px 11px', cursor: 'pointer', border: 0, flexShrink: 0,
              clipPath: CHUNKY_BADGE,
            }}
          >
            {t(`filter${k.charAt(0).toUpperCase() + k.slice(1)}` as any)} <span style={{ opacity: 0.6, marginLeft: 4 }}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {filtered.map(({ prediction, match, result, reward }) => (
        <Link
          key={prediction.matchId}
          href={`/match/${match.id}`}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <div style={{
            background: '#141414', border: '1px solid rgba(255,255,255,0.06)',
            padding: '10px 12px', marginBottom: 6,
            clipPath: CHUNKY_CARD,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <ResultDot result={result} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
                {match.round || ''} · {match.court || ''}
              </div>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 700, lineHeight: 1.3 }}>
                {prediction.pair === 1 ? match.pair1_player1?.name : match.pair2_player1?.name} · {prediction.margin}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {reward !== null ? (
                <div style={{
                  fontSize: 12, fontWeight: 800,
                  color: result === 'wrong' ? RED : result === 'upset' ? GOLD : GREEN,
                  fontVariantNumeric: 'tabular-nums',
                }}>+{reward} G</div>
              ) : (
                <div style={{ fontSize: 10, color: MUTED, fontWeight: 800 }}>{t('filterPending').toUpperCase()}</div>
              )}
            </div>
          </div>
        </Link>
      ))}
    </>
  )
}

function ResultDot({ result }: { result: PredictionResult | null }) {
  const sty: React.CSSProperties = {
    width: 28, height: 28, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 800, flexShrink: 0,
  }
  if (result === 'perfect') return <div style={{ ...sty, background: 'linear-gradient(135deg, #7ED321, #FFD166)', color: '#0a0a0a' }}>🎯</div>
  if (result === 'upset') return <div style={{ ...sty, background: 'linear-gradient(135deg, #FF6B2B, #FFD166)', color: '#0a0a0a' }}>🔥</div>
  if (result === 'right') return <div style={{ ...sty, background: GREEN, color: '#0a0a0a' }}>✓</div>
  if (result === 'wrong') return <div style={{ ...sty, background: 'rgba(255,70,85,0.18)', color: RED }}>✗</div>
  return <div style={{ ...sty, background: 'rgba(255,255,255,0.06)', color: MUTED, border: '0.5px dashed rgba(255,255,255,0.15)' }}>⏳</div>
}
```

- [ ] **Step 3: Create `page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase'
import type { Match } from '@/types/match'
import { computeReward, classifyResult, getMarginFromMatch } from '@/lib/predictions/scoring'
import { StatsHeader } from './StatsHeader'
import { PicksList } from './PicksList'
import { ClientPicks } from './ClientPicks'

export default async function PicksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'prediction.myPicks' })
  const session = await auth()
  if (!session?.user) redirect(`/${locale === 'en' ? '' : locale + '/'}auth/sign-in?next=/picks`)

  return (
    <main style={{ background: '#0a0a0a', minHeight: '100vh', padding: '16px 14px', color: '#fff' }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>{t('title')}</h1>
      <ClientPicks displayName={session.user.name ?? 'You'} />
    </main>
  )
}
```

- [ ] **Step 4: Create `ClientPicks.tsx`** (loads picks + matches client-side)

```tsx
'use client'

import { useEffect, useState } from 'react'
import { readAllPredictions } from '@/hooks/useMatchPrediction'
import type { Prediction } from '@/lib/predictions/types'
import type { Match } from '@/types/match'
import { classifyResult, computeReward, getMarginFromMatch } from '@/lib/predictions/scoring'
import { StatsHeader } from './StatsHeader'
import { PicksList } from './PicksList'

export function ClientPicks({ displayName }: { displayName: string }) {
  const [picks, setPicks] = useState<Array<{ prediction: Prediction; match: Match }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const all = readAllPredictions()
      if (all.length === 0) { setLoading(false); return }
      const ids = all.map(p => p.matchId)
      const res = await fetch(`/api/matches/by-ids?ids=${ids.join(',')}`)
      const matches: Match[] = res.ok ? await res.json() : []
      const byId = new Map(matches.map(m => [m.id, m]))
      const enriched = all
        .map(p => ({ prediction: p, match: byId.get(p.matchId) }))
        .filter((e): e is { prediction: Prediction; match: Match } => !!e.match)
      if (!cancelled) { setPicks(enriched); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Compute stats
  const totalGuacas = picks.reduce((sum, { prediction, match }) => {
    const r = classifyResult(prediction, match)
    if (!r) return sum
    const actualMargin = match.winner_pair ? getMarginFromMatch(match, match.winner_pair as 1 | 2) : null
    return sum + computeReward(prediction, r, actualMargin === prediction.margin)
  }, 0)
  const resolvedRight = picks.filter(({ prediction, match }) => {
    const r = classifyResult(prediction, match)
    return r === 'right' || r === 'perfect' || r === 'upset'
  }).length
  const resolvedWrong = picks.filter(({ prediction, match }) => classifyResult(prediction, match) === 'wrong').length
  const accuracyPct = (resolvedRight + resolvedWrong > 0)
    ? Math.round((resolvedRight / (resolvedRight + resolvedWrong)) * 100)
    : 0
  // Streak — count from most recent resolved backward
  const sorted = picks
    .map(p => ({ p, r: classifyResult(p.prediction, p.match) }))
    .filter(x => x.r !== null && x.r !== 'invalidated')
    .sort((a, b) => new Date(b.p.prediction.createdAt).getTime() - new Date(a.p.prediction.createdAt).getTime())
  let currentStreak = 0
  for (const { r } of sorted) {
    if (r === 'right' || r === 'perfect' || r === 'upset') currentStreak++
    else break
  }
  let bestStreak = 0, run = 0
  for (const { r } of sorted) {
    if (r === 'right' || r === 'perfect' || r === 'upset') { run++; bestStreak = Math.max(bestStreak, run) }
    else run = 0
  }

  if (loading) return <p style={{ color: '#6B7280' }}>Loading…</p>

  return (
    <>
      <StatsHeader
        displayName={displayName}
        rank={null}
        totalGuacas={totalGuacas}
        accuracyPct={accuracyPct}
        currentStreak={currentStreak}
        bestStreak={bestStreak}
      />
      <PicksList picks={picks} />
    </>
  )
}
```

- [ ] **Step 5: Create the `/api/matches/by-ids` route**

Create `src/app/api/matches/by-ids/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const idsParam = url.searchParams.get('ids')
  if (!idsParam) return NextResponse.json([])

  const ids = idsParam.split(',').filter(Boolean).slice(0, 200)
  if (ids.length === 0) return NextResponse.json([])

  const supabase = createServerSupabase()
  const { data, error } = await supabase
    .from('matches')
    .select('*, pair1_player1:pair1_player1_id(id, name, country, ranking), pair1_player2:pair1_player2_id(id, name, country, ranking), pair2_player1:pair2_player1_id(id, name, country, ranking), pair2_player2:pair2_player2_id(id, name, country, ranking), sets(*)')
    .in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
```

- [ ] **Step 6: Smoke test**

```bash
npm run dev
```

- Sign in.
- Make a few predictions on scheduled matches.
- Navigate to `/picks` (`/en/picks`).
- Verify: stats header populated, list renders, filters work, link to match detail works.

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/picks/ src/app/api/matches/by-ids/
git commit -m "feat(predictions): /picks page with stats + filtered list (Phase 1)"
```

---

### Task 12: End-to-end smoke test in dev preview

**Files:** None modified.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: server up on `localhost:3002`.

- [ ] **Step 2: Walk the full flow in the browser**

For each of these, verify behavior in the browser preview:

1. **Scheduled match in matches list**
   - Card shows green `[brain icon] PICK` button in the top-right.
   - No "PREDICTED" chip in the metadata row anymore.
   - Tap PICK → card expands. Pair-pick step visible.
   - Tap pair → margin step appears. Tap "Change" → back to pair pick.
   - Tap a margin → confirmation, auto-collapses ~1.4s later.
   - Re-expand → corner now reads "YOUR PICK".
   - "Tap to close" handle works at any step.
2. **Toss-up match (one or both players unranked)** — both pair buttons show "200 G if right" with no UPSET flag.
3. **Lopsided match** — one pair shows the UPSET flag and a higher reward.
4. **Live match** — green CTA gone. If you predicted: "YOUR PICK" pill. If not: "PICKS LOCKED". Tapping expands a read-only panel.
5. **Finished match where you predicted** — corner shows ✓ / 🎯 / 🔥 / ✗ badge. Tapping expands shows the result block + reward.
6. **Match detail page** — visiting `/match/{id}` shows the same prediction flow inside the existing PredictionSection slot.
7. **/picks page** — stats header populated, picks listed, filters work, deep-link to match detail works.
8. **i18n** — switch locale (`/es/picks`, `/pt/picks`, etc.). All strings render in the chosen locale; "guacas" stays untranslated.

- [ ] **Step 3: Capture a screenshot of the matches list with a predicted card open**

(Use whichever screenshot tool the team uses; attach to the PR description.)

- [ ] **Step 4: No commit**

This task produces no code; just sign-off on the smoke test.

---

## Self-review — pass

After writing the plan, I checked it against the spec:

**Spec coverage:**
- Corner CTA states (PICK / YOUR PICK / LOCKED / result-badge): Task 8 ✓
- Three collapse mechanisms: Task 9 ✓ (auto via `handleLocked` timer; manual via "Tap to close" handle; toggle via card body click)
- Expanded panel structure (prediction zone → probability bar → stats grid → community → sponsor): Tasks 6–7 ✓
- Live match read-only insights: Task 7 (`mode === 'live'` branch) ✓
- Finished match result block: Task 7 (`renderResultBlock`) + Task 8 (corner badge) ✓
- Guacas economy (stake 100, multiplier 1.00–5.00, +0.50× margin bonus): Tasks 1–3 ✓
- Probability model v1 (ranking-based logistic, [0.20, 0.80] clamp, fallback 0.50): Task 2 ✓
- Result classification (perfect / right / wrong / upset / invalidated, with UPSET precedence): Task 3 ✓
- /picks page (header, stats, filters, list): Task 11 ✓
- i18n keys for 5 locales: Task 5 ✓
- Match detail PredictionSection delegates to PredictionPanel: Task 10 ✓

**Spec gaps deferred to Phase 2:** server-side predictions table, leaderboard, real community %, resolution cron, API routes. All called out in the spec as Phase 2.

**Placeholder scan:** searched for "TBD", "TODO", "implement later" — none. All code blocks contain real implementations.

**Type consistency:**
- `Prediction.matchId / pair / margin / probability / multiplier / isFallback / createdAt` — used consistently across Tasks 1, 4, 6, 7, 11.
- `computeMatchProbability(match): { p1, p2, isFallback }` — Tasks 2, 6, 7 all use the same shape.
- `classifyResult(prediction, match): PredictionResult | null` — Tasks 3, 7, 11 all consume the same return type.
- `computeReward(prediction, result, marginCorrect): number` — Tasks 3, 7, 11 all match.

One inconsistency I caught and fixed in this pass: Task 7's `PredictionPanel` originally called `classifyResult` without the margin-correct parameter — fixed by reading actual margin via `getMarginFromMatch`.

---
