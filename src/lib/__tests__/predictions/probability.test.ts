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

  it('produces a non-saturated p1 for mid-table matchups (catches SCALE regressions)', () => {
    // Mid-table gap that should land strictly between 0.50 and the 0.80 clamp.
    // If SCALE drifts (or the formula changes), this is the test that fails first
    // — the [1,2] vs [50,60] case above always saturates to 0.80 and won't catch
    // tuning regressions.
    const r = computeMatchProbability(mockMatch([100, 110], [120, 130]))
    expect(r.p1).toBeGreaterThan(0.50)
    expect(r.p1).toBeLessThan(0.80)
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
