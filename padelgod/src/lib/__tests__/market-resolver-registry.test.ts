import { describe, it, expect } from 'vitest'
import { getResolver, listResolverKeys, RESOLVERS } from '../market-resolvers/index.js'

describe('resolver registry', () => {
  it('exposes every registered resolver', () => {
    expect(listResolverKeys().sort()).toEqual([
      'match.any_set_bagel',
      'match.went_to_three_sets',
      'match.winner_is_pair',
      'tournament.champion_is_pair',
    ])
  })

  it('returns a resolver by key', () => {
    expect(typeof getResolver('match.winner_is_pair')).toBe('function')
  })

  it('throws on an unknown key rather than returning undefined', () => {
    expect(() => getResolver('match.nope')).toThrow(/unknown resolver/i)
  })

  it('every registered key matches its map key', () => {
    for (const [key, fn] of Object.entries(RESOLVERS)) {
      expect(typeof fn).toBe('function')
      expect(key).toMatch(/^[a-z]+\.[a-z_]+$/)
    }
  })
})
