import { describe, it, expect } from 'vitest'
import { shouldShowFavTag } from '@/components/match-card-fav-tag'
import type { Match } from '@/types/match'

const m = (pred: number | null, status = 'scheduled') =>
  ({ id: 'x', status, pred_pair1_prob: pred } as unknown as Match)

describe('shouldShowFavTag', () => {
  it('shows on the favored pair only', () => {
    expect(shouldShowFavTag(m(0.62), 1, true)).toBe(true)   // pair 1 favored
    expect(shouldShowFavTag(m(0.62), 2, true)).toBe(false)
    expect(shouldShowFavTag(m(0.36), 2, true)).toBe(true)   // pair 2 favored
    expect(shouldShowFavTag(m(0.36), 1, true)).toBe(false)
  })
  it('hidden when no prediction or flag off', () => {
    expect(shouldShowFavTag(m(null), 1, true)).toBe(false)
    expect(shouldShowFavTag(m(0.62), 1, false)).toBe(false)
  })
})
