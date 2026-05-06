import { describe, it, expect } from 'vitest'
import { boostAndTrim } from '../suggested-players-helper'

describe('boostAndTrim', () => {
  const players = [
    { id: 'p1', ranking: 1, country: 'ARG', name: 'A' },
    { id: 'p2', ranking: 2, country: 'ESP', name: 'B' },
    { id: 'p3', ranking: 3, country: 'ARG', name: 'C' },
    { id: 'p4', ranking: 4, country: 'ESP', name: 'D' },
    { id: 'p5', ranking: 5, country: 'BRA', name: 'E' },
  ]

  it('boosts country matches to the top', () => {
    const out = boostAndTrim(players, 'ESP', 5)
    expect(out.map(p => p.id)).toEqual(['p2', 'p4', 'p1', 'p3', 'p5'])
  })

  it('trims to the requested limit', () => {
    const out = boostAndTrim(players, 'ESP', 3)
    expect(out.map(p => p.id)).toEqual(['p2', 'p4', 'p1'])
    expect(out).toHaveLength(3)
  })

  it('returns ranking-sorted when no country boost', () => {
    const out = boostAndTrim(players, null, 30)
    expect(out.map(p => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })
})
