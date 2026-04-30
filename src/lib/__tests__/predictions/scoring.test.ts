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
