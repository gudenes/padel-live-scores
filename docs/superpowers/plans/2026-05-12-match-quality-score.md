# Upcoming Match Quality Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute a 0–100 integer quality score for every upcoming padel match, surfaced through a new ops dashboard tab so the social/content team can scan matches and pick highlights.

**Architecture:** Pure scoring function in `src/lib/match-quality.ts`, no DB. New ops `GET /api/ops/highlight-picker` joins upcoming matches with player rankings and tournament tier, computes the score per row in JS, returns sorted JSON. New ops tab renders a sortable/filterable table. No database migration. No `feed-scoring.ts` changes (deferred until the team validates the calibration).

**Tech Stack:** Next.js 16 App Router, React 19, Supabase server client, vitest, TypeScript 5.

**Spec:** [docs/superpowers/specs/2026-05-12-match-quality-score-design.md](../specs/2026-05-12-match-quality-score-design.md)

---

## File map

| File | Purpose | New / Modify |
|---|---|---|
| `src/lib/match-quality.ts` | Pure scoring function `matchQualityScore()` + `matchQualityBreakdown()` | **New** |
| `src/lib/__tests__/match-quality.test.ts` | Vitest unit + integration tests for the formula | **New** |
| `src/lib/player-short-name.ts` | Paternal-surname display helper for ES/PT names | **New** |
| `src/lib/__tests__/player-short-name.test.ts` | Tests for the helper | **New** |
| `src/app/api/ops/highlight-picker/route.ts` | GET endpoint — scored upcoming matches in next 72h | **New** |
| `src/app/ops/HighlightPickerTab.tsx` | Table UI with sort + filters | **New** |
| `src/app/ops/OpsClient.tsx` | Register the new tab in the nav + body | **Modify** (≈3 lines added) |

---

## Task 1: Scaffold the module and the simplest primitive (parity)

**Files:**
- Create: `src/lib/match-quality.ts`
- Create: `src/lib/__tests__/match-quality.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/match-quality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parity, pWin } from '../match-quality'

describe('pWin (Elo-style)', () => {
  it('equal effective ranks → 0.5', () => {
    expect(pWin(50, 50)).toBeCloseTo(0.5, 5)
  })
  it('huge favorite (lower rank wins)', () => {
    // pair A rank 10 vs pair B rank 500 → A wins very likely
    expect(pWin(10, 500)).toBeGreaterThan(0.9)
  })
  it('monotonic in rank gap', () => {
    expect(pWin(50, 100)).toBeGreaterThan(pWin(50, 75))
  })
})

describe('parity', () => {
  it('equal pWin → 1.0 (tightest)', () => {
    expect(parity(0.5)).toBeCloseTo(1.0, 5)
  })
  it('blowout (pWin = 0.95) → 0.10', () => {
    expect(parity(0.95)).toBeCloseTo(0.10, 5)
  })
  it('total mismatch (pWin = 0) → 0.0', () => {
    expect(parity(0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: FAIL with "Cannot find module '../match-quality'"

- [ ] **Step 3: Create the module with the primitives**

Create `src/lib/match-quality.ts`:

```ts
// src/lib/match-quality.ts
//
// Pure scoring function for upcoming padel matches.
// 0–100 integer score blending player ranking parity, star presence,
// tournament tier and round multipliers. Internal-only — drives the
// ops highlight picker; feed-ranking integration deferred.
// See docs/superpowers/specs/2026-05-12-match-quality-score-design.md.

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** Elo-style expected win for pair A vs pair B (using effective pair ranks). */
export const pWin = (pA: number, pB: number): number =>
  1 / (1 + 10 ** ((pA - pB) / 400))

/** Parity: 1.0 = perfectly even, 0.0 = certain blowout. */
export const parity = (pWinA: number): number => 1 - 2 * Math.abs(pWinA - 0.5)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/match-quality.ts src/lib/__tests__/match-quality.test.ts
git commit -m "feat(match-quality): add pWin and parity primitives"
```

---

## Task 2: Pair effective rank + star damper

**Files:**
- Modify: `src/lib/match-quality.ts`
- Modify: `src/lib/__tests__/match-quality.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/__tests__/match-quality.test.ts`:

```ts
import { pairEffRank, starDamper, starPower } from '../match-quality'

describe('pairEffRank', () => {
  it('weights best 0.65, worst 0.35', () => {
    // best=10, worst=100 → 0.65*10 + 0.35*100 = 6.5 + 35 = 41.5
    expect(pairEffRank(10, 100)).toBeCloseTo(41.5, 5)
    expect(pairEffRank(100, 10)).toBeCloseTo(41.5, 5)  // order-insensitive
  })
  it('null rank uses 1500 fallback', () => {
    expect(pairEffRank(null, 50)).toBeCloseTo(0.65 * 50 + 0.35 * 1500, 5)
    expect(pairEffRank(null, null)).toBe(1500)
  })
  it('equal ranks → that rank', () => {
    expect(pairEffRank(40, 40)).toBe(40)
  })
})

describe('starPower (linear by avg rank)', () => {
  it('rank 0 → 1.0', () => {
    expect(starPower(0)).toBe(1.0)
  })
  it('rank 2000 → 0', () => {
    expect(starPower(2000)).toBe(0)
  })
  it('rank 1000 → 0.5', () => {
    expect(starPower(1000)).toBe(0.5)
  })
  it('clamps above 2000', () => {
    expect(starPower(3000)).toBe(0)
  })
})

describe('starDamper', () => {
  it('avg rank 0 → 1.0', () => {
    expect(starDamper(0)).toBe(1.0)
  })
  it('avg rank 2000 → 0.5', () => {
    expect(starDamper(2000)).toBe(0.5)
  })
  it('avg rank 1000 → 0.75', () => {
    expect(starDamper(1000)).toBe(0.75)
  })
})
```

- [ ] **Step 2: Run tests, see failures**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: FAIL with "Cannot find export pairEffRank" etc.

- [ ] **Step 3: Implement**

Append to `src/lib/match-quality.ts`:

```ts
/** When ranking is missing, treat the player as rank 1500 (deep tail). */
export const UNRANKED_FALLBACK = 1500

/**
 * Effective pair rank: weighted blend of the best and worst rankings.
 * Best gets 0.65 weight (one strong partner anchors the pair), worst 0.35.
 */
export function pairEffRank(
  rank1: number | null,
  rank2: number | null,
): number {
  const r1 = rank1 ?? UNRANKED_FALLBACK
  const r2 = rank2 ?? UNRANKED_FALLBACK
  const best = Math.min(r1, r2)
  const worst = Math.max(r1, r2)
  return best * 0.65 + worst * 0.35
}

/** Linear star-power from average rank: 0.0 at rank 2000+, 1.0 at rank 0. */
export const starPower = (avgRank: number): number =>
  clamp01((2000 - avgRank) / 2000)

/**
 * Star damper: multiplicative penalty applied to parity. Ranges 0.5–1.0.
 * A pair of top-50 players keeps the damper near 1; rank-1000s pull it to 0.75.
 * Designed to dampen never add — pure parity at the tail still produces a
 * floored score, but a balanced tail match cannot beat a balanced top match.
 */
export const starDamper = (avgRank: number): number =>
  0.5 + 0.5 * starPower(avgRank)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/match-quality.ts src/lib/__tests__/match-quality.test.ts
git commit -m "feat(match-quality): add pairEffRank, starPower, starDamper"
```

---

## Task 3: Round-string normalization + round weight + α (star-bonus weight by round)

**Files:**
- Modify: `src/lib/match-quality.ts`
- Modify: `src/lib/__tests__/match-quality.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { roundKey, roundWeight, alpha } from '../match-quality'

describe('roundKey (normalization)', () => {
  it('handles "Round of 32" and "R32" and "1/16" as r32', () => {
    expect(roundKey('Round of 32')).toBe('r32')
    expect(roundKey('R32')).toBe('r32')
    expect(roundKey('r32')).toBe('r32')
    expect(roundKey('1/16')).toBe('r32')
  })
  it('handles R16/R64/R128', () => {
    expect(roundKey('Round of 16')).toBe('r16')
    expect(roundKey('Round of 64')).toBe('r64')
    expect(roundKey('Round of 128')).toBe('r128')
  })
  it('handles Final, SF, QF in various forms', () => {
    expect(roundKey('Final')).toBe('final')
    expect(roundKey('FINAL')).toBe('final')
    expect(roundKey('Semifinal')).toBe('sf')
    expect(roundKey('1/2')).toBe('sf')
    expect(roundKey('SF')).toBe('sf')
    expect(roundKey('Quarterfinal')).toBe('qf')
    expect(roundKey('1/4')).toBe('qf')
    expect(roundKey('QF')).toBe('qf')
  })
  it('handles qualifying rounds', () => {
    expect(roundKey('Q1')).toBe('q')
    expect(roundKey('Q2')).toBe('q')
    expect(roundKey('Qualifying')).toBe('q')
  })
  it('unknown or null → "unknown"', () => {
    expect(roundKey(null)).toBe('unknown')
    expect(roundKey('')).toBe('unknown')
    expect(roundKey('Group Stage')).toBe('unknown')
  })
  it('does NOT match SF as final', () => {
    // "Semifinal" contains "final" — must NOT classify as Final.
    expect(roundKey('Semifinal')).toBe('sf')
  })
})

describe('roundWeight', () => {
  it('Final is the only round above 1.0', () => {
    expect(roundWeight('Final')).toBe(1.15)
    expect(roundWeight('Semifinal')).toBeLessThan(1.0)
  })
  it('R32 > R64 > R128 > Q', () => {
    expect(roundWeight('R32')).toBeGreaterThan(roundWeight('R64'))
    expect(roundWeight('R64')).toBeGreaterThan(roundWeight('R128'))
    expect(roundWeight('R128')).toBeGreaterThan(roundWeight('Q1'))
  })
  it('unknown falls back to 0.55', () => {
    expect(roundWeight('Group Stage')).toBe(0.55)
  })
})

describe('alpha (star-bonus weight by round)', () => {
  it('Final = 0.0 (parity-only decides)', () => {
    expect(alpha('Final')).toBe(0.00)
  })
  it('Qualifying = 0.35 (star matters most)', () => {
    expect(alpha('Q1')).toBe(0.35)
  })
  it('decreases monotonically Q → Final', () => {
    expect(alpha('Q1')).toBeGreaterThan(alpha('R128'))
    expect(alpha('R128')).toBeGreaterThan(alpha('R64'))
    expect(alpha('R64')).toBeGreaterThan(alpha('R32'))
    expect(alpha('R32')).toBeGreaterThan(alpha('R16'))
    expect(alpha('R16')).toBeGreaterThan(alpha('QF'))
    expect(alpha('QF')).toBeGreaterThan(alpha('SF'))
    expect(alpha('SF')).toBeGreaterThan(alpha('Final'))
  })
})
```

- [ ] **Step 2: Run tests, see failures**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: FAIL (Cannot find roundKey, roundWeight, alpha)

- [ ] **Step 3: Implement**

Append to `src/lib/match-quality.ts`:

```ts
export type RoundKey =
  | 'final' | 'sf' | 'qf' | 'r16' | 'r32' | 'r64' | 'r128' | 'q' | 'unknown'

/**
 * Normalize a raw round string into a canonical key. The DB stores
 * inconsistent formats — "Round of 32" from padelapi, "R32" from
 * Crionet, "1/16" from FIP — all of which should collapse to 'r32'.
 *
 * Why this is a substring matcher with explicit early-outs rather
 * than a regex: "Semifinal" contains "final" and "Quarterfinal"
 * contains "quarter" — naïve substring matches misclassify them.
 */
export function roundKey(raw: string | null | undefined): RoundKey {
  if (!raw) return 'unknown'
  const s = raw.toLowerCase().replace(/\s+/g, '')
  // Check most-specific patterns first.
  if (s.includes('semi') || s === '1/2' || s === 'sf') return 'sf'
  if (s.includes('quarter') || s === '1/4' || s === 'qf') return 'qf'
  if (s.includes('final')) return 'final'
  if (s.includes('roundof128') || s.includes('r128')) return 'r128'
  if (s.includes('roundof64') || s.includes('r64') || s === '1/32') return 'r64'
  if (s.includes('roundof32') || s.includes('r32') || s === '1/16') return 'r32'
  if (s.includes('roundof16') || s.includes('r16') || s === '1/8') return 'r16'
  if (s.startsWith('q') || s.includes('quali')) return 'q'
  return 'unknown'
}

const ROUND_WEIGHT_TABLE: Record<RoundKey, number> = {
  final: 1.15,
  sf: 0.90,
  qf: 0.80,
  r16: 0.70,
  r32: 0.62,
  r64: 0.55,
  r128: 0.48,
  q: 0.40,
  unknown: 0.55,
}
export const roundWeight = (raw: string | null | undefined): number =>
  ROUND_WEIGHT_TABLE[roundKey(raw)]

const ALPHA_TABLE: Record<RoundKey, number> = {
  final: 0.00,
  sf: 0.05,
  qf: 0.10,
  r16: 0.15,
  r32: 0.20,
  r64: 0.25,
  r128: 0.30,
  q: 0.35,
  unknown: 0.20,
}
/**
 * α(round) — how much the star bonus weighs at this round.
 * Early rounds need star pull because there's no marquee parity story
 * (every R64 is two unknown mid-50s); Finals don't need it (everyone
 * left is a star, parity decides).
 */
export const alpha = (raw: string | null | undefined): number =>
  ALPHA_TABLE[roundKey(raw)]
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/match-quality.ts src/lib/__tests__/match-quality.test.ts
git commit -m "feat(match-quality): add roundKey normalization, roundWeight, alpha"
```

---

## Task 4: Tier weight + star strength

**Files:**
- Modify: `src/lib/match-quality.ts`
- Modify: `src/lib/__tests__/match-quality.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { tierWeight, starStrength } from '../match-quality'

describe('tierWeight', () => {
  it('p1 = 1.00', () => expect(tierWeight('p1')).toBe(1.00))
  it('major = 0.95', () => expect(tierWeight('major')).toBe(0.95))
  it('p2, premier_mens, premier_womens = 0.85', () => {
    expect(tierWeight('p2')).toBe(0.85)
    expect(tierWeight('premier_mens')).toBe(0.85)
    expect(tierWeight('premier_womens')).toBe(0.85)
  })
  it('fip tiers descend', () => {
    expect(tierWeight('fip_gold')).toBe(0.75)
    expect(tierWeight('fip_silver')).toBe(0.70)
    expect(tierWeight('fip_bronze')).toBe(0.65)
  })
  it('case-insensitive', () => {
    expect(tierWeight('P1')).toBe(1.00)
    expect(tierWeight('FIP_BRONZE')).toBe(0.65)
  })
  it('null / unknown → 0.70', () => {
    expect(tierWeight(null)).toBe(0.70)
    expect(tierWeight('amateur')).toBe(0.70)
  })
})

describe('starStrength (by best rank on court)', () => {
  it('top 5 → 1.00', () => {
    expect(starStrength(1)).toBe(1.00)
    expect(starStrength(5)).toBe(1.00)
  })
  it('top 6-15 → 0.75', () => {
    expect(starStrength(6)).toBe(0.75)
    expect(starStrength(15)).toBe(0.75)
  })
  it('top 16-30 → 0.50', () => {
    expect(starStrength(16)).toBe(0.50)
    expect(starStrength(30)).toBe(0.50)
  })
  it('top 31-60 → 0.25', () => {
    expect(starStrength(31)).toBe(0.25)
    expect(starStrength(60)).toBe(0.25)
  })
  it('top 61-100 → 0.10', () => {
    expect(starStrength(61)).toBe(0.10)
    expect(starStrength(100)).toBe(0.10)
  })
  it('> 100 → 0', () => {
    expect(starStrength(101)).toBe(0)
    expect(starStrength(500)).toBe(0)
  })
  it('null → 0', () => {
    expect(starStrength(null)).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests, see failures**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: FAIL (Cannot find tierWeight, starStrength)

- [ ] **Step 3: Implement**

Append to `src/lib/match-quality.ts`:

```ts
const TIER_WEIGHT_TABLE: Record<string, number> = {
  p1: 1.00,
  major: 0.95,
  p2: 0.85,
  premier_mens: 0.85,
  premier_womens: 0.85,
  fip_gold: 0.75,
  fip_silver: 0.70,
  fip_bronze: 0.65,
}
const TIER_UNKNOWN_WEIGHT = 0.70
export function tierWeight(level: string | null | undefined): number {
  if (!level) return TIER_UNKNOWN_WEIGHT
  return TIER_WEIGHT_TABLE[level.toLowerCase()] ?? TIER_UNKNOWN_WEIGHT
}

/**
 * Star strength tier-by-rank. Stepped (not smooth) so it's easy to
 * audit and tune — moving the #15/#16 boundary is one number, not a
 * curve-fit. Beyond #100 there's effectively no draw.
 */
export function starStrength(bestRankOnCourt: number | null): number {
  if (bestRankOnCourt == null) return 0
  if (bestRankOnCourt <= 5) return 1.00
  if (bestRankOnCourt <= 15) return 0.75
  if (bestRankOnCourt <= 30) return 0.50
  if (bestRankOnCourt <= 60) return 0.25
  if (bestRankOnCourt <= 100) return 0.10
  return 0
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/match-quality.ts src/lib/__tests__/match-quality.test.ts
git commit -m "feat(match-quality): add tierWeight and starStrength"
```

---

## Task 5: Full `matchQualityScore` composition + integration tests

**Files:**
- Modify: `src/lib/match-quality.ts`
- Modify: `src/lib/__tests__/match-quality.test.ts`

- [ ] **Step 1: Write failing integration tests**

Append to test file:

```ts
import { matchQualityScore } from '../match-quality'

describe('matchQualityScore (integration)', () => {
  it('returns an integer in [0, 100]', () => {
    const score = matchQualityScore({
      pair1Rankings: [13, 14],
      pair2Rankings: [50, 44],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(Number.isInteger(score)).toBe(true)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('Salazar/Alonso scenario: top-15 stars vs top-50 R32 in P1 → 60-70', () => {
    // From BA P1 2026-05-12: Salazar(#13)/Alonso(#14) vs Luján(#50)/Nogueira(#44)
    const score = matchQualityScore({
      pair1Rankings: [13, 14],
      pair2Rankings: [50, 44],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(score).toBeGreaterThanOrEqual(60)
    expect(score).toBeLessThanOrEqual(70)
  })

  it('balanced mid-30s R32 in P1 → 60-65 (slightly below star match)', () => {
    // Collombon(#34)/Cabruja(#54) vs Gomez(#37)/Ortiz(#41)
    const score = matchQualityScore({
      pair1Rankings: [34, 54],
      pair2Rankings: [37, 41],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(score).toBeGreaterThanOrEqual(60)
    expect(score).toBeLessThanOrEqual(65)
  })

  it('big mismatch with one star (#33 vs #240 R32 P1) → 25-35', () => {
    // Banchero(#240)/Jimenez(#240) vs Borrero(#43)/Sharifova(#33)
    const score = matchQualityScore({
      pair1Rankings: [240, 240],
      pair2Rankings: [43, 33],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(score).toBeGreaterThanOrEqual(25)
    expect(score).toBeLessThanOrEqual(35)
  })

  it('balanced top-10 Final in P1 → ≥ 90 (the ceiling case)', () => {
    const score = matchQualityScore({
      pair1Rankings: [5, 6],
      pair2Rankings: [7, 8],
      tournamentLevel: 'p1',
      round: 'Final',
    })
    expect(score).toBeGreaterThanOrEqual(90)
  })

  it('balanced FIP Bronze Final at rank ~125 → 65-80 (Prishtina shape)', () => {
    const score = matchQualityScore({
      pair1Rankings: [124, 124],
      pair2Rankings: [129, 128],
      tournamentLevel: 'fip_bronze',
      round: 'Final',
    })
    expect(score).toBeGreaterThanOrEqual(65)
    expect(score).toBeLessThanOrEqual(80)
  })

  it('any unranked player → < 5', () => {
    expect(matchQualityScore({
      pair1Rankings: [13, 14],
      pair2Rankings: [50, null],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })).toBeLessThan(5)

    expect(matchQualityScore({
      pair1Rankings: [null, null],
      pair2Rankings: [null, null],
      tournamentLevel: 'p1',
      round: 'Final',
    })).toBeLessThan(5)
  })

  it('unknown round string does not throw and is mid-range', () => {
    const score = matchQualityScore({
      pair1Rankings: [40, 50],
      pair2Rankings: [45, 55],
      tournamentLevel: 'p1',
      round: 'Group Stage',
    })
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })

  it('case-insensitive tier and round inputs', () => {
    const a = matchQualityScore({
      pair1Rankings: [13, 14], pair2Rankings: [50, 44],
      tournamentLevel: 'P1', round: 'Round of 32',
    })
    const b = matchQualityScore({
      pair1Rankings: [13, 14], pair2Rankings: [50, 44],
      tournamentLevel: 'p1', round: 'round of 32',
    })
    expect(a).toBe(b)
  })

  it('FIP Bronze Final tier-round multiplication chains correctly', () => {
    // tier 0.65 × round 1.15 = 0.7475 ceiling before clamp — verify the
    // formula doesn't accidentally hit 1.0 from a balanced midweight match.
    const score = matchQualityScore({
      pair1Rankings: [200, 200],
      pair2Rankings: [200, 200],
      tournamentLevel: 'fip_bronze',
      round: 'Final',
    })
    // parity ≈ 1, star_damper ≈ 0.55, bonus = 0 at Final → ~0.55 × 0.65 × 1.15 ≈ 0.411
    expect(score).toBeGreaterThanOrEqual(35)
    expect(score).toBeLessThanOrEqual(45)
  })
})
```

- [ ] **Step 2: Run tests, see failures**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: FAIL (Cannot find matchQualityScore)

- [ ] **Step 3: Implement the public API**

Append to `src/lib/match-quality.ts`:

```ts
const UNRANKED_PENALTY = 0.15

export interface MatchQualityInput {
  pair1Rankings: [number | null, number | null]
  pair2Rankings: [number | null, number | null]
  tournamentLevel: string | null
  round: string | null
}

function hasUnranked(input: MatchQualityInput): boolean {
  return (
    input.pair1Rankings[0] == null ||
    input.pair1Rankings[1] == null ||
    input.pair2Rankings[0] == null ||
    input.pair2Rankings[1] == null
  )
}

function bestRankOnCourt(input: MatchQualityInput): number | null {
  const ranks = [
    input.pair1Rankings[0],
    input.pair1Rankings[1],
    input.pair2Rankings[0],
    input.pair2Rankings[1],
  ].filter((r): r is number => r != null)
  if (ranks.length === 0) return null
  return Math.min(...ranks)
}

/** Raw 0–1 quality (unrounded). Exposed for breakdown / integration callers. */
function rawQuality(input: MatchQualityInput): number {
  const pA = pairEffRank(input.pair1Rankings[0], input.pair1Rankings[1])
  const pB = pairEffRank(input.pair2Rankings[0], input.pair2Rankings[1])
  const par = parity(pWin(pA, pB))
  const damper = starDamper((pA + pB) / 2)
  const bonus = alpha(input.round) * starStrength(bestRankOnCourt(input))
  const tw = tierWeight(input.tournamentLevel)
  const rw = roundWeight(input.round)
  const unr = hasUnranked(input) ? UNRANKED_PENALTY : 1
  return clamp01((par * damper + bonus) * tw * rw * unr)
}

/** Integer score in [0, 100]. */
export function matchQualityScore(input: MatchQualityInput): number {
  return Math.round(rawQuality(input) * 100)
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/match-quality.ts src/lib/__tests__/match-quality.test.ts
git commit -m "feat(match-quality): add matchQualityScore composition + integration tests"
```

---

## Task 6: `matchQualityBreakdown` debug variant

Used by the ops table tooltip so the team can see why a match scored what it did.

**Files:**
- Modify: `src/lib/match-quality.ts`
- Modify: `src/lib/__tests__/match-quality.test.ts`

- [ ] **Step 1: Write failing test**

Append:

```ts
import { matchQualityBreakdown } from '../match-quality'

describe('matchQualityBreakdown', () => {
  it('returns intermediate components alongside the score', () => {
    const b = matchQualityBreakdown({
      pair1Rankings: [13, 14],
      pair2Rankings: [50, 44],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(b).toMatchObject({
      score: expect.any(Number),
      parity: expect.any(Number),
      starDamper: expect.any(Number),
      starBonus: expect.any(Number),
      tierW: expect.any(Number),
      roundW: expect.any(Number),
      unrankedPenalty: 1,
    })
    expect(b.score).toBe(matchQualityScore({
      pair1Rankings: [13, 14], pair2Rankings: [50, 44],
      tournamentLevel: 'p1', round: 'Round of 32',
    }))
  })

  it('flags unrankedPenalty when any player is unranked', () => {
    const b = matchQualityBreakdown({
      pair1Rankings: [13, null],
      pair2Rankings: [50, 44],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(b.unrankedPenalty).toBe(0.15)
  })
})
```

- [ ] **Step 2: Run tests, see failures**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: FAIL (Cannot find matchQualityBreakdown)

- [ ] **Step 3: Implement**

Append to `src/lib/match-quality.ts`:

```ts
export interface MatchQualityBreakdown {
  score: number          // 0–100 integer (same as matchQualityScore)
  parity: number         // 0..1
  starDamper: number     // 0.5..1.0
  starBonus: number      // 0..0.35
  tierW: number          // 0.65..1.00
  roundW: number         // 0.40..1.15
  unrankedPenalty: number // 1 or 0.15
}

export function matchQualityBreakdown(input: MatchQualityInput): MatchQualityBreakdown {
  const pA = pairEffRank(input.pair1Rankings[0], input.pair1Rankings[1])
  const pB = pairEffRank(input.pair2Rankings[0], input.pair2Rankings[1])
  const par = parity(pWin(pA, pB))
  const damper = starDamper((pA + pB) / 2)
  const bonus = alpha(input.round) * starStrength(bestRankOnCourt(input))
  const tw = tierWeight(input.tournamentLevel)
  const rw = roundWeight(input.round)
  const unr = hasUnranked(input) ? UNRANKED_PENALTY : 1
  return {
    score: Math.round(clamp01((par * damper + bonus) * tw * rw * unr) * 100),
    parity: par,
    starDamper: damper,
    starBonus: bonus,
    tierW: tw,
    roundW: rw,
    unrankedPenalty: unr,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/match-quality.test.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/match-quality.ts src/lib/__tests__/match-quality.test.ts
git commit -m "feat(match-quality): add matchQualityBreakdown for ops tooltip"
```

---

## Task 7: Player short-name helper (paternal-surname convention)

The existing `shortName` in `src/components/home/shared.tsx` takes the *last* token, which mis-displays Spanish double-surname names ("Alejandra Salazar Bengoechea" → "Bengoechea" instead of the recognizable "Salazar"). We need the **paternal surname** (second token for 3+ token names) for the ops picker — and likely later for other surfaces. New module, leave the legacy `shortName` alone to avoid visual regressions in `home/`.

**Files:**
- Create: `src/lib/player-short-name.ts`
- Create: `src/lib/__tests__/player-short-name.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/player-short-name.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { playerShortName } from '../player-short-name'

describe('playerShortName (paternal-surname convention)', () => {
  it('3-token Spanish name → middle token (paternal surname)', () => {
    expect(playerShortName('Alejandra Salazar Bengoechea')).toBe('Salazar')
    expect(playerShortName('Alejandra Alonso De Villa')).toBe('Alonso')
  })
  it('4-token name with compound first name → second token', () => {
    expect(playerShortName('Juan Carlos Ruiz Diaz')).toBe('Carlos')
    // Acceptable trade-off: heuristic can't know "Juan Carlos" is one name.
    // Document this limitation; rare and visually still recognizable.
  })
  it('2-token name → last token', () => {
    expect(playerShortName('Agustin Tapia')).toBe('Tapia')
    expect(playerShortName('Juan Lebron')).toBe('Lebron')
  })
  it('1-token name → return as-is', () => {
    expect(playerShortName('Madonna')).toBe('Madonna')
  })
  it('null / empty → fallback dash', () => {
    expect(playerShortName(null)).toBe('—')
    expect(playerShortName('')).toBe('—')
    expect(playerShortName('   ')).toBe('—')
  })
  it('trims and collapses whitespace', () => {
    expect(playerShortName('  Alejandra  Salazar  Bengoechea  ')).toBe('Salazar')
  })
})
```

- [ ] **Step 2: Run tests, see failures**

Run: `npx vitest run src/lib/__tests__/player-short-name.test.ts`
Expected: FAIL (Cannot find module ../player-short-name)

- [ ] **Step 3: Implement**

Create `src/lib/player-short-name.ts`:

```ts
// src/lib/player-short-name.ts
//
// Renders a player's recognizable short name. Spanish and Portuguese
// names commonly have two surnames — the paternal surname (the second
// token of "Nombre Apellido1 Apellido2") is the broadcast/recognized
// form. The legacy `shortName` in src/components/home/shared.tsx takes
// the LAST token, which silently renames "Alejandra Salazar Bengoechea"
// to "Bengoechea". Use THIS helper for any surface where operators or
// the social team scan rosters.
//
// Heuristic — known trade-off: compound first names ("Juan Carlos
// Ruiz Diaz") get the second token ("Carlos") rather than the paternal
// surname. Rare; still visually disambiguates.

export function playerShortName(name: string | null | undefined): string {
  if (!name) return '—'
  const trimmed = name.trim()
  if (!trimmed) return '—'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[1]
  // 3+ tokens: paternal surname is token[1]
  return parts[1]
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/player-short-name.test.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/player-short-name.ts src/lib/__tests__/player-short-name.test.ts
git commit -m "feat(player-short-name): add paternal-surname display helper"
```

---

## Task 8: Ops API route — `/api/ops/highlight-picker`

GET endpoint that queries upcoming matches in the next 72h, computes quality scores in JS, returns sorted JSON. Auth via `ops_token` cookie (same pattern as other `/api/ops/*` routes).

**Files:**
- Create: `src/app/api/ops/highlight-picker/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/ops/highlight-picker/route.ts`:

```ts
// src/app/api/ops/highlight-picker/route.ts
//
// Returns upcoming matches (next 72h) scored by matchQualityScore,
// sorted by score desc. Backs the ops Highlight Picker tab.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import { matchQualityBreakdown } from '@/lib/match-quality'

export const dynamic = 'force-dynamic'

interface RowOut {
  matchId: string
  score: number
  breakdown: ReturnType<typeof matchQualityBreakdown>
  round: string | null
  category: string | null
  scheduledAt: string | null
  court: string | null
  tournament: { id: string; name: string; level: string | null; country: string | null }
  pair1: { name: string | null; ranking: number | null }[]
  pair2: { name: string | null; ranking: number | null }[]
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'server_misconfigured' }, { status: 401 })
  }
  const cookie = (await cookies()).get('ops_token')?.value
  if (cookie !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'token_mismatch' }, { status: 401 })
  }

  // Query params: window=24|48|72 (hours, default 24), tier=p1,p2,... (comma list), category=men|women|all
  const url = new URL(req.url)
  const windowHours = Number.parseInt(url.searchParams.get('window') ?? '24', 10)
  const tierFilterRaw = url.searchParams.get('tier')
  const tierFilter = tierFilterRaw ? tierFilterRaw.split(',').map(s => s.trim().toLowerCase()) : null
  const categoryFilter = url.searchParams.get('category')
  const minScore = Number.parseInt(url.searchParams.get('minScore') ?? '0', 10)

  const supabase = createServerClient()

  const nowIso = new Date().toISOString()
  const endIso = new Date(Date.now() + windowHours * 60 * 60 * 1000).toISOString()

  let q = supabase
    .from('matches')
    .select(`
      id, round, category, status, scheduled_at, court,
      tournament:tournaments(id, name, level, country),
      pair1_player1:players!matches_pair1_player1_id_fkey(name, ranking),
      pair1_player2:players!matches_pair1_player2_id_fkey(name, ranking),
      pair2_player1:players!matches_pair2_player1_id_fkey(name, ranking),
      pair2_player2:players!matches_pair2_player2_id_fkey(name, ranking)
    `)
    .in('status', ['scheduled', 'upcoming'])
    .gte('scheduled_at', nowIso)
    .lt('scheduled_at', endIso)

  if (categoryFilter && categoryFilter !== 'all') {
    q = q.eq('category', categoryFilter)
  }

  const { data, error } = await q.order('scheduled_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: RowOut[] = []
  for (const m of data ?? []) {
    const t = m.tournament as { id: string; name: string; level: string | null; country: string | null } | null
    if (!t) continue
    if (tierFilter && (!t.level || !tierFilter.includes(t.level.toLowerCase()))) continue

    const breakdown = matchQualityBreakdown({
      pair1Rankings: [
        (m.pair1_player1 as { ranking: number | null } | null)?.ranking ?? null,
        (m.pair1_player2 as { ranking: number | null } | null)?.ranking ?? null,
      ],
      pair2Rankings: [
        (m.pair2_player1 as { ranking: number | null } | null)?.ranking ?? null,
        (m.pair2_player2 as { ranking: number | null } | null)?.ranking ?? null,
      ],
      tournamentLevel: t.level,
      round: m.round,
    })
    if (breakdown.score < minScore) continue

    rows.push({
      matchId: m.id,
      score: breakdown.score,
      breakdown,
      round: m.round,
      category: m.category,
      scheduledAt: m.scheduled_at,
      court: m.court,
      tournament: t,
      pair1: [
        m.pair1_player1 as { name: string | null; ranking: number | null } ?? { name: null, ranking: null },
        m.pair1_player2 as { name: string | null; ranking: number | null } ?? { name: null, ranking: null },
      ],
      pair2: [
        m.pair2_player1 as { name: string | null; ranking: number | null } ?? { name: null, ranking: null },
        m.pair2_player2 as { name: string | null; ranking: number | null } ?? { name: null, ranking: null },
      ],
    })
  }

  rows.sort((a, b) => b.score - a.score)
  return NextResponse.json({ items: rows, generatedAt: new Date().toISOString() })
}
```

- [ ] **Step 2: Smoke-test the route**

Start dev server in one terminal:
```bash
npm run dev
```

In another terminal (after dev server is ready):
```bash
# First, set the ops_token cookie by hitting /ops?token=$CRON_SECRET
# Then test the route directly with a Cookie header — easiest is to use
# the curl --cookie-jar dance, OR set the cookie manually in your browser
# at http://localhost:3002/ops?token=YOUR_CRON_SECRET, then visit
# http://localhost:3002/api/ops/highlight-picker?window=72 in the same
# browser session.

# Quick CLI smoke test:
TOKEN="$(grep CRON_SECRET .env.local | cut -d= -f2 | tr -d '\"' )"
curl -s "http://localhost:3002/api/ops/highlight-picker?window=72" \
  --cookie "ops_token=$TOKEN" | head -50
```
Expected: JSON `{ items: [...], generatedAt: "..." }` with rows sorted by score desc.
If `items` is empty, verify there are matches in the next 72h with `status in ('scheduled','upcoming')`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ops/highlight-picker/route.ts
git commit -m "feat(ops): add highlight-picker API route returning scored upcoming matches"
```

---

## Task 9: Ops `HighlightPickerTab.tsx` component

**Files:**
- Create: `src/app/ops/HighlightPickerTab.tsx`

- [ ] **Step 1: Implement the tab**

Create `src/app/ops/HighlightPickerTab.tsx`:

```tsx
'use client'
// src/app/ops/HighlightPickerTab.tsx
//
// Read-only table of upcoming matches scored by matchQualityScore.
// The social/content team uses this to pick highlights. Sort by score
// desc by default; filter by time window, tier, category, min score.

import { useEffect, useMemo, useState } from 'react'
import { playerShortName } from '@/lib/player-short-name'

interface PlayerRef { name: string | null; ranking: number | null }
interface Item {
  matchId: string
  score: number
  breakdown: {
    score: number
    parity: number
    starDamper: number
    starBonus: number
    tierW: number
    roundW: number
    unrankedPenalty: number
  }
  round: string | null
  category: string | null
  scheduledAt: string | null
  court: string | null
  tournament: { id: string; name: string; level: string | null; country: string | null }
  pair1: PlayerRef[]
  pair2: PlayerRef[]
}

const TIER_OPTIONS = [
  { key: 'p1', label: 'P1' },
  { key: 'major', label: 'Major' },
  { key: 'p2', label: 'P2' },
  { key: 'premier_mens', label: 'Premier M' },
  { key: 'premier_womens', label: 'Premier W' },
  { key: 'fip_gold', label: 'FIP Gold' },
  { key: 'fip_silver', label: 'FIP Silver' },
  { key: 'fip_bronze', label: 'FIP Bronze' },
]

export default function HighlightPickerTab() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [windowHours, setWindowHours] = useState<24 | 48 | 72>(24)
  const [tiers, setTiers] = useState<Set<string>>(new Set(TIER_OPTIONS.map(t => t.key)))
  const [category, setCategory] = useState<'all' | 'men' | 'women'>('all')
  const [minScore, setMinScore] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    params.set('window', String(windowHours))
    if (category !== 'all') params.set('category', category)
    if (tiers.size < TIER_OPTIONS.length) params.set('tier', [...tiers].join(','))
    if (minScore > 0) params.set('minScore', String(minScore))
    try {
      const r = await fetch(`/api/ops/highlight-picker?${params.toString()}`, { cache: 'no-store' })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setError(body.error || `HTTP ${r.status}`)
        setItems([])
      } else {
        const body = await r.json()
        setItems(body.items ?? [])
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  useEffect(() => { refresh() }, [windowHours, category, minScore, tiers])

  const toggleTier = (key: string) => {
    setTiers(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const formatScheduled = (iso: string | null): string => {
    if (!iso) return '—'
    const d = new Date(iso)
    const now = Date.now()
    const deltaH = (d.getTime() - now) / 3_600_000
    const local = d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    if (deltaH < 1) return `${local} (<1h)`
    if (deltaH < 24) return `${local} (in ${Math.round(deltaH)}h)`
    return local
  }

  const renderPair = (pair: PlayerRef[]): string => {
    return pair
      .map(p => `${playerShortName(p.name)}${p.ranking ? ` #${p.ranking}` : ''}`)
      .join(' / ')
  }

  const tierBadgeColor = (level: string | null): { bg: string; fg: string } => {
    const l = (level || '').toLowerCase()
    if (l === 'p1') return { bg: '#fef3c7', fg: '#92400e' }
    if (l === 'major') return { bg: '#fde68a', fg: '#92400e' }
    if (l === 'p2' || l.startsWith('premier')) return { bg: '#dbeafe', fg: '#1e40af' }
    if (l === 'fip_gold') return { bg: '#fef9c3', fg: '#854d0e' }
    if (l === 'fip_silver') return { bg: '#e5e7eb', fg: '#374151' }
    if (l === 'fip_bronze') return { bg: '#fee2e2', fg: '#991b1b' }
    return { bg: '#f3f4f6', fg: '#374151' }
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Highlight Picker</h2>
        <span style={{ fontSize: 12, color: '#666' }}>{loading ? 'loading…' : `${items.length} matches`}</span>
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 13 }}>
          Window:{' '}
          <select value={windowHours} onChange={e => setWindowHours(Number(e.target.value) as 24 | 48 | 72)} style={{ padding: '4px 8px' }}>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
            <option value={72}>72h</option>
          </select>
        </label>

        <label style={{ fontSize: 13 }}>
          Category:{' '}
          <select value={category} onChange={e => setCategory(e.target.value as 'all' | 'men' | 'women')} style={{ padding: '4px 8px' }}>
            <option value="all">All</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
          </select>
        </label>

        <label style={{ fontSize: 13 }}>
          Min score:{' '}
          <input
            type="range" min={0} max={100} value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
            style={{ verticalAlign: 'middle' }}
          />
          <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>{minScore}</span>
        </label>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TIER_OPTIONS.map(t => (
            <button
              key={t.key}
              onClick={() => toggleTier(t.key)}
              style={{
                padding: '4px 10px', borderRadius: 12, border: '1px solid #ccc',
                background: tiers.has(t.key) ? '#111' : '#fff',
                color: tiers.has(t.key) ? '#fff' : '#666',
                cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8, textAlign: 'right', width: 60 }}>Score</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Match</th>
              <th style={{ padding: 8, textAlign: 'left', width: 110 }}>Round</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Tournament</th>
              <th style={{ padding: 8, textAlign: 'left', width: 60 }}>Cat</th>
              <th style={{ padding: 8, textAlign: 'left', width: 160 }}>Scheduled</th>
              <th style={{ padding: 8, textAlign: 'left', width: 60 }}>Court</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const t = item.tournament
              const tb = tierBadgeColor(t.level)
              return (
                <tr key={item.matchId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td
                    style={{ padding: 8, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    title={
                      `parity ${item.breakdown.parity.toFixed(2)}\n` +
                      `damper ${item.breakdown.starDamper.toFixed(2)}\n` +
                      `bonus ${item.breakdown.starBonus.toFixed(2)}\n` +
                      `tier ${item.breakdown.tierW.toFixed(2)}\n` +
                      `round ${item.breakdown.roundW.toFixed(2)}\n` +
                      `unranked penalty ${item.breakdown.unrankedPenalty}`
                    }
                  >
                    {item.score}
                  </td>
                  <td style={{ padding: 8 }}>
                    <a href={`/match/${item.matchId}`} target="_blank" rel="noopener noreferrer" style={{ color: '#111', textDecoration: 'underline' }}>
                      {renderPair(item.pair1)}  vs  {renderPair(item.pair2)}
                    </a>
                  </td>
                  <td style={{ padding: 8 }}>{item.round ?? '—'}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                      background: tb.bg, color: tb.fg, fontSize: 10, fontWeight: 700,
                      marginRight: 6,
                    }}>{t.level ?? '—'}</span>
                    {t.name}
                  </td>
                  <td style={{ padding: 8 }}>{item.category ?? '—'}</td>
                  <td style={{ padding: 8 }}>{formatScheduled(item.scheduledAt)}</td>
                  <td style={{ padding: 8 }}>{item.court ?? '—'}</td>
                </tr>
              )
            })}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#999' }}>No upcoming matches matched your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit (UI not wired yet, next task)**

```bash
git add src/app/ops/HighlightPickerTab.tsx
git commit -m "feat(ops): add HighlightPickerTab UI component"
```

---

## Task 10: Wire the tab into `OpsClient.tsx`

**Files:**
- Modify: `src/app/ops/OpsClient.tsx`

- [ ] **Step 1: Add the import**

In `src/app/ops/OpsClient.tsx`, find the existing tab imports (around line 26 after the `import NewsTab from './NewsTab'` line) and add:

```tsx
import HighlightPickerTab from './HighlightPickerTab'
```

- [ ] **Step 2: Add 'highlight-picker' to the tab union type**

Find the `useState` line for `tab` (around line 324):

```tsx
const [tab, setTab] = useState<'ongoing' | 'health' | 'data' | 'simulator' | 'players' | 'brands' | 'architecture' | 'padelgod-shadow' | 'padelgod-entries' | 'tournament-explorer' | 'tournament-dedup' | 'padelgod-health' | 'fip-streams' | 'news'>('ongoing')
```

Add `'highlight-picker'` to the union:

```tsx
const [tab, setTab] = useState<'ongoing' | 'health' | 'data' | 'simulator' | 'players' | 'brands' | 'architecture' | 'padelgod-shadow' | 'padelgod-entries' | 'tournament-explorer' | 'tournament-dedup' | 'padelgod-health' | 'fip-streams' | 'news' | 'highlight-picker'>('ongoing')
```

- [ ] **Step 3: Add the nav entry**

Find the `navGroups` definition (around line 415). Inside the `'Data Management'` group, add a new item before `architecture`:

```tsx
{
  label: 'Data Management',
  items: [
    { key: 'players' as const, label: 'Players', badge: null },
    { key: 'brands' as const, label: 'Brands & Equipment', badge: null },
    { key: 'fip-streams' as const, label: 'FIP Streams', badge: null },
    { key: 'news' as const, label: 'News', badge: null },
    { key: 'highlight-picker' as const, label: 'Highlight Picker', badge: null },  // ← NEW
    { key: 'architecture' as const, label: 'Architecture', badge: null },
  ],
},
```

- [ ] **Step 4: Add the body rendering**

Find the line `{tab === 'news' && <NewsTab />}` (around line 1005). Add immediately after it:

```tsx
{tab === 'highlight-picker' && <HighlightPickerTab />}
```

- [ ] **Step 5: Manual smoke test**

```bash
npm run dev
```

1. Open `http://localhost:3002/ops?token=$CRON_SECRET` in the browser (replace `$CRON_SECRET` with the real value from `.env.local`). This sets the `ops_token` cookie.
2. Click "Highlight Picker" in the sidebar under "Data Management".
3. Verify:
   - Table renders with rows sorted by score desc
   - Filters (window / tier / category / min score) change results
   - Hovering a Score cell shows the breakdown tooltip
   - Clicking a match link opens `/match/<id>` in a new tab
   - Player names use the paternal-surname form (e.g., "Salazar" not "Bengoechea")

- [ ] **Step 6: Commit**

```bash
git add src/app/ops/OpsClient.tsx
git commit -m "feat(ops): wire Highlight Picker into ops dashboard nav"
```

---

## Task 11: Lint + typecheck the whole change

- [ ] **Step 1: Lint**

```bash
npm run lint
```
Expected: PASS (or only warnings unrelated to the new files).

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: PASS. Fix any TypeScript errors introduced; common gotchas:
- Supabase return-type widening — cast through `as { ... } | null` as needed
- `force-dynamic` directive present on the API route

- [ ] **Step 3: Run the full test file once more**

```bash
npx vitest run src/lib/__tests__/match-quality.test.ts src/lib/__tests__/player-short-name.test.ts
```
Expected: all tests pass (~60 tests across both files).

- [ ] **Step 4: Commit any fix-ups (if any)**

```bash
# Only if there were fixes
git add -A
git commit -m "chore: typecheck + lint pass on match-quality work"
```

---

## Task 12: Push branch and open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin spec/match-quality-score
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: upcoming match quality score + ops highlight picker" --body "$(cat <<'EOF'
## Summary
- Pure 0–100 match quality formula in `src/lib/match-quality.ts`: parity × star_damper + star_bonus, multiplied by tier × round × unranked penalty
- New ops tab `/ops` → **Highlight Picker** lets the social/content team scan scored upcoming matches over the next 24–72h
- ~60 unit/integration tests including a calibration baseline anchored on BA P1 2026-05-12 marquee matches

Spec: `docs/superpowers/specs/2026-05-12-match-quality-score-design.md` (in this branch)

Feed-scoring integration deferred — wire as a multiplier in `feed-scoring.ts` after 1–2 weeks of team use confirms the calibration against real picks.

## Test plan
- [ ] `npx vitest run src/lib/__tests__/match-quality.test.ts` — all green
- [ ] `npx vitest run src/lib/__tests__/player-short-name.test.ts` — all green
- [ ] `npm run build` succeeds
- [ ] Visit `/ops?token=$CRON_SECRET` → Highlight Picker tab → table renders, filters work, breakdown tooltip on Score column, paternal-surname names

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage:**
- Formula → Tasks 1–6 ✓
- Module API → Task 5 (`matchQualityScore`), Task 6 (`matchQualityBreakdown`) ✓
- Ops highlight picker UI → Tasks 9, 10 ✓
- Ops API route + auth → Task 8 ✓
- Compute model (on-read) → implicit in Task 8 (no migration) ✓
- Edge cases (unranked, unknown round, null tier) → Task 5 tests cover all three ✓
- Test matrix → Tasks 1–6 collectively cover component + integration + calibration snapshot ✓
- Display name helper → Task 7 ✓
- No DB migration → confirmed ✓
- No `feed-scoring.ts` changes → confirmed ✓

**Things deferred per spec (correctly not in this plan):**
- Feed integration
- Stored `matches.quality_score` column
- Live-match score, H2H, recent-form bonuses

**Risk callouts for implementer:**
- The `roundKey` matcher has an order-dependent check (`semi` and `quarter` before `final`) — don't reorder.
- The Supabase relationship-hint syntax in the select (e.g., `players!matches_pair1_player1_id_fkey`) must match the actual FK names in the DB. If a typo here causes "Could not find foreign key" at runtime, check `\d matches` in the Supabase SQL editor for the real constraint names.
- The ops route uses `dynamic = 'force-dynamic'` because it reads cookies. Don't remove it.
- Player names use paternal-surname convention (`playerShortName`), not the legacy `shortName` in `home/shared.tsx`. Don't accidentally swap them.
