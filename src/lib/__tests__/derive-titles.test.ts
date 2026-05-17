import { describe, it, expect } from 'vitest'
import { deriveTitles } from '../derive-titles'
import type { MatchRowForTitles } from '../derive-titles'

const player = { id: 'p1', name: 'Lucas', display_name: 'Lucas Bergamini' }
const partner = { id: 'p2', name: 'Javi', display_name: 'Javi Garrido' }
const opp1 = { id: 'p3', name: 'Galan', display_name: 'Galan' }
const opp2 = { id: 'p4', name: 'Tapia', display_name: 'Tapia' }

const finalMatch = (overrides: Partial<MatchRowForTitles> = {}): MatchRowForTitles => ({
  id: 'm1',
  round: 'F',
  status: 'finished',
  winner_pair: 1,
  played_at: '2026-04-15',
  finished_at: '2026-04-15T18:00:00Z',
  scheduled_at: null,
  pair1_player1: player,
  pair1_player2: partner,
  pair2_player1: opp1,
  pair2_player2: opp2,
  tournament: { id: 't1', name: 'FIP Gold Lisbon', level: 'fip_gold' },
  ...overrides,
})

describe('deriveTitles', () => {
  it('returns empty array when player has no finals', () => {
    expect(deriveTitles([], 'p1')).toEqual([])
  })

  it('returns one title for a single final won', () => {
    const result = deriveTitles([finalMatch()], 'p1')
    expect(result).toHaveLength(1)
    expect(result[0].tournamentId).toBe('t1')
    expect(result[0].tournamentName).toBe('FIP Gold Lisbon')
    expect(result[0].partner?.id).toBe('p2')
  })

  it('ignores finals where the player lost', () => {
    const lost = finalMatch({ winner_pair: 2 })
    expect(deriveTitles([lost], 'p1')).toEqual([])
  })

  it('ignores non-final rounds', () => {
    const sf = finalMatch({ round: 'SF' })
    expect(deriveTitles([sf], 'p1')).toEqual([])
  })

  it('ignores in-progress matches', () => {
    const live = finalMatch({ status: 'live', winner_pair: null })
    expect(deriveTitles([live], 'p1')).toEqual([])
  })

  it('counts a retired final as a title for the winner', () => {
    const retired = finalMatch({ status: 'retired' })
    expect(deriveTitles([retired], 'p1')).toHaveLength(1)
  })

  it('counts a walkover final as a title for the winner', () => {
    const wo = finalMatch({ status: 'walkover' })
    expect(deriveTitles([wo], 'p1')).toHaveLength(1)
  })

  it('handles player on pair2 (not pair1)', () => {
    const onPair2 = finalMatch({
      pair1_player1: opp1,
      pair1_player2: opp2,
      pair2_player1: player,
      pair2_player2: partner,
      winner_pair: 2,
    })
    const result = deriveTitles([onPair2], 'p1')
    expect(result).toHaveLength(1)
    expect(result[0].partner?.id).toBe('p2')
  })

  it('returns multiple titles sorted by date desc', () => {
    const may = finalMatch({ id: 'm-may', tournament: { id: 'tm', name: 'May Cup', level: 'fip_silver' }, finished_at: '2026-05-10T18:00:00Z' })
    const apr = finalMatch({ id: 'm-apr', tournament: { id: 'ta', name: 'Apr Cup', level: 'fip_gold' }, finished_at: '2026-04-10T18:00:00Z' })
    const result = deriveTitles([apr, may], 'p1')
    expect(result.map(t => t.tournamentId)).toEqual(['tm', 'ta'])
  })

  it('dedupes if the same tournament_id appears twice', () => {
    const dup = finalMatch({ id: 'm-dup' })
    expect(deriveTitles([finalMatch(), dup], 'p1')).toHaveLength(1)
  })
})
