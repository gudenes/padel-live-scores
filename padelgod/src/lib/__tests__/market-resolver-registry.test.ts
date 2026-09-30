import { describe, it, expect } from 'vitest'
import { getResolver, listResolverKeys, RESOLVERS } from '../market-resolvers/index.js'

describe('resolver registry', () => {
  it('exposes every registered resolver', () => {
    expect(listResolverKeys().sort()).toEqual([
      'match.any_set_bagel',
      'match.went_to_three_sets',
      'match.winner_is_pair',
      'player.reaches_ranking_v1',
      'season.pair_title_count_v1',
      'tournament.bagel_count_at_least_v1',
      'tournament.champion_is_pair',
      'tournament.other_pair_wins_v1',
      'tournament.pair_reaches_round_v1',
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
      expect(key).toMatch(/^[a-z]+\.[a-z_0-9]+$/)
    }
  })
})
