import { describe, it, expect } from 'vitest'
import { isPickWindowOpen, buildPredictionRow } from '../server'
import type { Match } from '@/types/match'

const baseMatch: Match = {
  id: 'm1',
  status: 'scheduled',
  scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  pair1_player1: { id: 'p1', ranking: 10 },
  pair1_player2: { id: 'p2', ranking: 12 },
  pair2_player1: { id: 'p3', ranking: 50 },
  pair2_player2: { id: 'p4', ranking: 55 },
} as unknown as Match

describe('isPickWindowOpen', () => {
  it('open when match is scheduled and starts in the future', () => {
    expect(isPickWindowOpen(baseMatch, new Date())).toBe(true)
  })

  it('closed when match has already started', () => {
    const m = { ...baseMatch, scheduled_at: new Date(Date.now() - 1000).toISOString() }
    expect(isPickWindowOpen(m, new Date())).toBe(false)
  })

  it('closed when status is not scheduled', () => {
    const m = { ...baseMatch, status: 'live' }
    expect(isPickWindowOpen(m, new Date())).toBe(false)
  })

  it('closed when status is finished', () => {
    const m = { ...baseMatch, status: 'finished' }
    expect(isPickWindowOpen(m, new Date())).toBe(false)
  })

  it('open when scheduled_at is null (unscheduled but not yet locked)', () => {
    const m = { ...baseMatch, scheduled_at: null as unknown as string }
    expect(isPickWindowOpen(m, new Date())).toBe(true)
  })
})

describe('buildPredictionRow', () => {
  it('computes probability and multiplier server-side from the match', () => {
    const row = buildPredictionRow(baseMatch, { userId: 'u1', pair: 1, margin: '2-0' })
    expect(row.user_id).toBe('u1')
    expect(row.match_id).toBe('m1')
    expect(row.pair).toBe(1)
    expect(row.margin).toBe('2-0')
    // pair 1 is the favorite (avg ranking 11 vs 52.5), so prob > 0.5
    expect(row.probability).toBeGreaterThan(0.5)
    expect(row.multiplier).toBeGreaterThanOrEqual(1)
    expect(row.is_fallback).toBe(false)
  })

  it('falls back to 50/50 when rankings missing', () => {
    const m = { ...baseMatch, pair1_player1: { id: 'p1', ranking: null } } as unknown as Match
    const row = buildPredictionRow(m, { userId: 'u1', pair: 1, margin: '2-1' })
    expect(row.probability).toBe(0.5)
    expect(row.is_fallback).toBe(true)
  })

  it('uses pair 2 probability when user picks pair 2', () => {
    const row = buildPredictionRow(baseMatch, { userId: 'u1', pair: 2, margin: '2-0' })
    // Pair 2 is underdog so prob < 0.5
    expect(row.probability).toBeLessThan(0.5)
  })
})
