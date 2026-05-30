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
