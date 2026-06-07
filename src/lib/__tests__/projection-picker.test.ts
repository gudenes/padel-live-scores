import { describe, it, expect } from 'vitest'
import type { Match, Player } from '@/types/match'
import type { ProjectionRow } from '@/lib/projection-types'
import { buildSeedMap, isQualifyingRound, orderPickerPairs, pairKeyFromIds } from '@/lib/projection-picker'

function player(id: string): Player { return { id, external_id: id, name: id, country: 'ES', avatar_url: null } }
function match(round: string, opts: Partial<Match>): Match {
  return {
    id: 'm', external_id: 'e', status: 'finished', coverage: null, pusher_channel: null, round,
    court: null, scheduled_at: null, started_at: null, finished_at: null, winner_pair: null,
    pair1_player1: null, pair1_player2: null, pair2_player1: null, pair2_player2: null,
    pair1_seed: null, pair2_seed: null, ...opts,
  } as Match
}
function row(key: string, ids: [string, string], champ: number, status: ProjectionRow['status'] = 'active'): ProjectionRow {
  return { tournament_id: 't', category: 'men', pair_key: key, pair_player_ids: ids, tournament_level: 'p1',
    status, eliminated_round: status === 'eliminated' ? 'R16' : null, champion_prob: champ, finalist_prob: 0, semifinal_prob: 0, rounds: [], computed_at: 'now' }
}

describe('buildSeedMap', () => {
  it('maps a pair key to its seed from matches', () => {
    const m = {
      id: 'm', external_id: 'e', status: 'scheduled', coverage: null, pusher_channel: null, round: 'SF',
      court: null, scheduled_at: null, started_at: null, finished_at: null, winner_pair: null,
      pair1_player1: player('a'), pair1_player2: player('b'), pair2_player1: player('c'), pair2_player2: player('d'),
      pair1_seed: 1, pair2_seed: null,
    } as Match
    const map = buildSeedMap([m])
    expect(map.get(pairKeyFromIds('a', 'b'))).toBe(1)
    expect(map.has(pairKeyFromIds('c', 'd'))).toBe(false)
  })

  it('ignores qualifying-draw seeds but keeps Quarterfinals seeds', () => {
    // A qualifier seeded #1 in Q1/Q2/Q3 must NOT show as a main-draw seed,
    // while a genuine main-draw seed carried on a Quarterfinals row must.
    const map = buildSeedMap([
      match('Q1', { pair1_player1: player('x'), pair1_player2: player('y'), pair1_seed: 1 }),
      match('Q3', { pair1_player1: player('x'), pair1_player2: player('y'), pair1_seed: 1 }),
      match('Quarterfinals', { pair2_player1: player('m'), pair2_player2: player('n'), pair2_seed: 5 }),
    ])
    expect(map.has(pairKeyFromIds('x', 'y'))).toBe(false) // Q-seed dropped
    expect(map.get(pairKeyFromIds('m', 'n'))).toBe(5)     // Quarterfinals seed kept
  })
})

describe('isQualifyingRound', () => {
  it('matches qualifying rounds only, not Quarterfinals', () => {
    for (const r of ['Q1', 'Q2', 'Q3', 'q1', 'Qualifying', 'Qualification']) {
      expect(isQualifyingRound(r)).toBe(true)
    }
    for (const r of ['Quarterfinals', 'QF', 'Round of 32', 'SF', 'F', null, undefined, '']) {
      expect(isQualifyingRound(r)).toBe(false)
    }
  })
})

describe('orderPickerPairs', () => {
  const rows = [
    row('u1', ['u', '1'], 0.04),
    row('s3', ['s', '3'], 0.10),
    row('s1', ['s', '1'], 0.40),
    row('s5', ['s', '5'], 0.02),
    row('s2', ['s', '2'], 0.20),
    row('s4', ['s', '4'], 0.08),
    row('e1', ['e', '1'], 0, 'eliminated'),
  ]
  const seedMap = new Map<string, number>([['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4], ['s5', 5], ['e1', 6]])

  it('features the top 4 active by seed; rest after; eliminated at the bottom', () => {
    const { feature, rest, eliminated } = orderPickerPairs(rows, seedMap)
    expect(feature.map(r => r.pair_key)).toEqual(['s1', 's2', 's3', 's4'])
    expect(rest.map(r => r.pair_key)).toEqual(['s5', 'u1'])
    expect(eliminated.map(r => r.pair_key)).toEqual(['e1'])
  })

  it('no feature cards when fewer than 2 seeded active pairs', () => {
    const justOne = [row('s1', ['s', '1'], 0.4), row('u1', ['u', '1'], 0.1), row('u2', ['u', '2'], 0.2)]
    const { feature, rest } = orderPickerPairs(justOne, new Map([['s1', 1]]))
    expect(feature).toEqual([])
    expect(rest.map(r => r.pair_key)).toEqual(['s1', 'u2', 'u1'])
  })
})
