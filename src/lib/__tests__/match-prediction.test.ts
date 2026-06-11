// src/lib/__tests__/match-prediction.test.ts
import { describe, it, expect } from 'vitest'
import { getMatchPrediction } from '@/lib/match-prediction'
import type { Match } from '@/types/match'

const base = { id: 'm1' } as unknown as Match

describe('getMatchPrediction', () => {
  it('returns null when no prediction', () => {
    expect(getMatchPrediction({ ...base, pred_pair1_prob: null })).toBeNull()
    expect(getMatchPrediction({ ...base })).toBeNull()
  })

  it('favors pair 1 when p >= 0.5 and rounds the displayed pct', () => {
    const r = getMatchPrediction({ ...base, pred_pair1_prob: 0.62 })!
    expect(r.favored).toBe(1)
    expect(r.pct).toBe(62)
    expect(r.pair1Prob).toBeCloseTo(0.62)
  })

  it('favors pair 2 when p < 0.5 and shows the larger side pct', () => {
    const r = getMatchPrediction({ ...base, pred_pair1_prob: 0.36 })!
    expect(r.favored).toBe(2)
    expect(r.pct).toBe(64)
  })

  it('treats exactly 0.5 as pair 1 favored at 50%', () => {
    const r = getMatchPrediction({ ...base, pred_pair1_prob: 0.5 })!
    expect(r.favored).toBe(1)
    expect(r.pct).toBe(50)
  })
})
