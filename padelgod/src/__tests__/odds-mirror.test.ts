import { describe, it, expect } from 'vitest'
import { computeOdds } from '../lib/odds'

describe('odds mirror', () => {
  it('computes a pre-match prior in padelgod', () => {
    const r = computeOdds({ rankings: [1, 2, 200, 210], score: null, pointByPoint: false })
    expect(r.pair1WinProb).toBeCloseTo(0.8, 5)
    expect(r.confidence).toBe('pre-match')
  })
})
