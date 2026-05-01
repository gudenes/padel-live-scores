// src/lib/__tests__/predictions/scoring.test.ts
import { describe, it, expect } from 'vitest'
import { classifyResult, computeReward, getMarginFromMatch } from '@/lib/predictions/scoring'
import { HEAVY_UPSET_THRESHOLD } from '@/lib/predictions/constants'
import type { Prediction } from '@/lib/predictions/types'
import type { Match } from '@/types/match'

function mockFinishedMatch(opts: {
  status?: string
  winner?: 1 | 2 | null
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
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'walkover' }))?.result).toBe('invalidated')
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'retired' }))?.result).toBe('invalidated')
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'cancelled' }))?.result).toBe('invalidated')
  })

  it('returns wrong when the user picked the loser', () => {
    const m = mockFinishedMatch({ winner: 2, sets: [{ p1: 4, p2: 6 }, { p1: 4, p2: 6 }] })
    const r = classifyResult({ ...basePrediction, pair: 1 }, m)
    expect(r?.result).toBe('wrong')
    expect(r?.marginCorrect).toBe(false)
  })

  it('returns right when pair correct but margin off', () => {
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 6, p2: 3 }] })
    const r = classifyResult({ ...basePrediction, pair: 1, margin: '2-0' }, m)
    expect(r?.result).toBe('right')
    expect(r?.marginCorrect).toBe(false)
  })

  it('returns perfect when pair + margin both correct (prob > heavy-upset threshold)', () => {
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }] })
    const r = classifyResult({ ...basePrediction, pair: 1, margin: '2-0', probability: 0.6 }, m)
    expect(r?.result).toBe('perfect')
    expect(r?.marginCorrect).toBe(true)
  })

  it('returns upset when user picked underdog winner with prob ≤ 0.25 (precedence over perfect)', () => {
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }] })
    // Even with margin perfect, it's still UPSET because prob ≤ threshold —
    // but marginCorrect is preserved so reward calc still applies the bonus.
    const r1 = classifyResult({ ...basePrediction, pair: 1, margin: '2-0', probability: 0.20 }, m)
    expect(r1?.result).toBe('upset')
    expect(r1?.marginCorrect).toBe(true)
    const r2 = classifyResult({ ...basePrediction, pair: 1, margin: '2-0', probability: HEAVY_UPSET_THRESHOLD }, m)
    expect(r2?.result).toBe('upset')
    expect(r2?.marginCorrect).toBe(true)
  })

  it('returns null when match not yet finished', () => {
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'scheduled' }))).toBe(null)
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'live' }))).toBe(null)
  })

  it('returns null when match is finished but winner_pair is missing', () => {
    // The `'ended'` status is treated as terminal but the winner_pair guard
    // catches the not-yet-resolved case (CLAUDE.md "Match Status Lifecycle").
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'finished', winner: null }))).toBe(null)
    expect(classifyResult(basePrediction, mockFinishedMatch({ status: 'ended', winner: null }))).toBe(null)
  })

  it('returns right (not perfect) when pair correct but margin can\'t be resolved from sets', () => {
    // Finished + winner set, but only 1 set's worth of game data → getMarginFromMatch returns null.
    const m = mockFinishedMatch({ winner: 1, sets: [{ p1: 6, p2: 4 }] })
    const r = classifyResult({ ...basePrediction, pair: 1, margin: '2-0', probability: 0.6 }, m)
    expect(r?.result).toBe('right')
    expect(r?.marginCorrect).toBe(false)
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
  const wrongClassified = { result: 'wrong' as const, marginCorrect: false }
  const invalidatedClassified = { result: 'invalidated' as const, marginCorrect: false }
  const rightNoMargin = { result: 'right' as const, marginCorrect: false }
  const perfectWithMargin = { result: 'perfect' as const, marginCorrect: true }
  const upsetWithMargin = { result: 'upset' as const, marginCorrect: true }
  const upsetNoMargin = { result: 'upset' as const, marginCorrect: false }

  it('returns 0 for wrong picks', () => {
    expect(computeReward({ ...basePrediction, multiplier: 3.0 }, wrongClassified)).toBe(0)
  })

  it('returns 0 for invalidated picks', () => {
    expect(computeReward({ ...basePrediction, multiplier: 3.0 }, invalidatedClassified)).toBe(0)
  })

  it('returns base multiplier × stake for "right" (no margin bonus)', () => {
    // 100 stake × 1.47 multiplier = 147
    expect(computeReward({ ...basePrediction, multiplier: 1.47 }, rightNoMargin)).toBe(147)
  })

  it('adds margin bonus for "perfect"', () => {
    // 100 × (1.47 + 0.50) = 197
    expect(computeReward({ ...basePrediction, multiplier: 1.47 }, perfectWithMargin)).toBe(197)
  })

  it('adds margin bonus on top of cap-saturated multiplier for upsets', () => {
    // The cap (5.00) is enforced upstream in computeMultiplier; here we
    // just verify computeReward correctly stacks the +0.50 bonus on a
    // multiplier that's already at the cap.
    // 100 × (5.00 + 0.50) = 550
    expect(computeReward({ ...basePrediction, multiplier: 5.00 }, upsetWithMargin)).toBe(550)
  })

  it('upset without margin bonus is just base', () => {
    expect(computeReward({ ...basePrediction, multiplier: 3.13 }, upsetNoMargin)).toBe(313)
  })
})
