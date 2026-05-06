import { describe, it, expect } from 'vitest'
import { applyCountryBoost } from '../country-boost-sort'

interface Row { id: string; ranking: number; country: string }

const rows: Row[] = [
  { id: 'a', ranking: 1, country: 'ARG' },
  { id: 'b', ranking: 2, country: 'ESP' },
  { id: 'c', ranking: 3, country: 'ARG' },
  { id: 'd', ranking: 4, country: 'ESP' },
  { id: 'e', ranking: 5, country: 'BRA' },
]

describe('applyCountryBoost', () => {
  it('returns input untouched when no boost country given', () => {
    const out = applyCountryBoost(rows, null, r => r.country)
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('moves boosted-country players to the top, preserving ranking among them', () => {
    const out = applyCountryBoost(rows, 'ESP', r => r.country)
    expect(out.map(r => r.id)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('preserves relative ranking among non-boosted players', () => {
    const out = applyCountryBoost(rows, 'ESP', r => r.country)
    const nonBoost = out.filter(r => r.country !== 'ESP').map(r => r.id)
    expect(nonBoost).toEqual(['a', 'c', 'e'])
  })

  it('handles boost country not present (no change)', () => {
    const out = applyCountryBoost(rows, 'JPN', r => r.country)
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('is case-insensitive on country code', () => {
    const out = applyCountryBoost(rows, 'esp', r => r.country)
    expect(out.map(r => r.id)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('does not mutate the input', () => {
    const before = rows.map(r => r.id).join(',')
    applyCountryBoost(rows, 'ESP', r => r.country)
    expect(rows.map(r => r.id).join(',')).toBe(before)
  })
})
