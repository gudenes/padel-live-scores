import { describe, it, expect } from 'vitest'
import { projectedFinishRound, type RoadRoundVM } from '@/lib/projection-view'

const rd = (round: RoadRoundVM['round'], reachProb: number): RoadRoundVM =>
  ({ round, dateIso: null, reachProb, expected: null, opponents: [] })

describe('projectedFinishRound', () => {
  it('returns the deepest round with reach >= 0.5', () => {
    expect(projectedFinishRound([rd('R64', 1), rd('R32', 1), rd('R16', 0.86), rd('QF', 0.55), rd('SF', 0.3), rd('F', 0.12)])).toBe('QF')
  })
  it('returns the Final for a strong favourite', () => {
    expect(projectedFinishRound([rd('R32', 1), rd('R16', 0.9), rd('QF', 0.8), rd('SF', 0.7), rd('F', 0.55)])).toBe('F')
  })
  it('falls back to the entry round when no later round is favoured', () => {
    expect(projectedFinishRound([rd('R32', 1), rd('R16', 0.2)])).toBe('R32')
  })
  it('returns null for empty rounds', () => {
    expect(projectedFinishRound([])).toBeNull()
  })
})
