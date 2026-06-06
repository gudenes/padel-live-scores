import { describe, it, expect } from 'vitest'
import type { Match, Player } from '@/types/match'
import type { ProjectionRow } from '@/lib/projection-types'
import {
  buildPlayerLookup,
  pickDefaultProjectionPair,
  roundDateFor,
  buildRoadVM,
  ROUND_LABEL_KEY,
} from '@/lib/projection-view'

function player(id: string, name: string, country = 'ES', avatar = `http://x/${id}.png`): Player {
  return { id, external_id: id, name, country, avatar_url: avatar, ranking: 1 }
}
function match(p: (Player | null)[]): Match {
  return {
    id: `m-${p.map(x => x?.id).join('')}`, external_id: 'e', status: 'scheduled', coverage: null,
    pusher_channel: null, round: 'SF', court: null, scheduled_at: null, started_at: null,
    finished_at: null, winner_pair: null,
    pair1_player1: p[0] ?? null, pair1_player2: p[1] ?? null,
    pair2_player1: p[2] ?? null, pair2_player2: p[3] ?? null,
  } as Match
}

const A = player('a', 'Galan'); const B = player('b', 'Chingotto')
const C = player('c', 'Coello'); const D = player('d', 'Tapia')

describe('buildPlayerLookup', () => {
  it('indexes every non-null player from matches by id', () => {
    const map = buildPlayerLookup([match([A, B, C, D])])
    expect(map.get('a')?.name).toBe('Galan')
    expect(map.get('d')?.country).toBe('ES')
    expect(map.size).toBe(4)
  })
})

describe('roundDateFor', () => {
  it('maps a round code to the matching round_schedule key', () => {
    const sched = { r16: '2026-06-06', qf: '2026-06-08', sf: '2026-06-09', f: '2026-06-10' }
    expect(roundDateFor('QF', sched)).toBe('2026-06-08')
    expect(roundDateFor('F', sched)).toBe('2026-06-10')
    expect(roundDateFor('SF', null)).toBeNull()
    expect(roundDateFor('QF', { sf: 'x' })).toBeNull()
  })
})

describe('ROUND_LABEL_KEY', () => {
  it('maps every round code to an i18n key', () => {
    expect(ROUND_LABEL_KEY.QF).toBe('roundQF')
    expect(ROUND_LABEL_KEY.F).toBe('roundF')
  })
})

describe('pickDefaultProjectionPair', () => {
  const rows = [
    { pair_key: 'a::b', pair_player_ids: ['a', 'b'], champion_prob: 0.2 },
    { pair_key: 'c::d', pair_player_ids: ['c', 'd'], champion_prob: 0.5 },
  ] as ProjectionRow[]

  it('prefers a pair containing a bookmarked player', () => {
    expect(pickDefaultProjectionPair(rows, ['a'])).toBe('a::b')
  })
  it('falls back to the highest champion_prob pair', () => {
    expect(pickDefaultProjectionPair(rows, [])).toBe('c::d')
  })
  it('returns null for no rows', () => {
    expect(pickDefaultProjectionPair([], ['a'])).toBeNull()
  })
})

describe('buildRoadVM', () => {
  const row: ProjectionRow = {
    tournament_id: 't', category: 'men', pair_key: 'a::b', pair_player_ids: ['a', 'b'],
    tournament_level: 'p1', champion_prob: 0.22, finalist_prob: 0.4, semifinal_prob: 0.7,
    computed_at: 'now',
    rounds: [
      { round: 'SF', reach_prob: 1, expected_opponent_pair_key: 'c::d',
        opponents: [{ pair_key: 'c::d', player_ids: ['c', 'd'], names: ['Coello', 'Tapia'], reach_prob: 0.6, win_prob: 0.55 }] },
      { round: 'F', reach_prob: 0.5, expected_opponent_pair_key: null, opponents: [] },
    ],
  }
  const lookup = buildPlayerLookup([match([A, B, C, D])])
  const sched = { sf: '2026-06-09', f: '2026-06-10' }

  it('produces a VM with resolved players, dates, expected opponent', () => {
    const vm = buildRoadVM(row, lookup, sched)
    expect(vm.championProb).toBe(0.22)
    expect(vm.players.map(p => p.name)).toEqual(['Galan', 'Chingotto'])
    const sf = vm.rounds[0]
    expect(sf.round).toBe('SF')
    expect(sf.dateIso).toBe('2026-06-09')
    expect(sf.expected?.players.map(p => p.name)).toEqual(['Coello', 'Tapia'])
    expect(sf.expected?.winProb).toBe(0.55)
    expect(sf.expected?.faceProb).toBe(0.6)
    expect(vm.rounds[1].expected).toBeNull()
  })

  it('resolves opponent avatars/countries from the lookup, falling back to JSON names', () => {
    const vm = buildRoadVM(row, lookup, sched)
    const opp = vm.rounds[0].expected!
    expect(opp.players[0].avatarUrl).toBe('http://x/c.png')
    expect(opp.players[0].country).toBe('ES')
    const row2 = { ...row, rounds: [{ ...row.rounds[0], opponents: [{ pair_key: 'z::y', player_ids: ['z', 'y'], names: ['Zed', 'Yan'], reach_prob: 0.3, win_prob: 0.4 }], expected_opponent_pair_key: 'z::y' }] }
    const vm2 = buildRoadVM(row2 as ProjectionRow, lookup, sched)
    expect(vm2.rounds[0].expected?.players[0].name).toBe('Zed')
    expect(vm2.rounds[0].expected?.players[0].avatarUrl).toBeNull()
  })
})
