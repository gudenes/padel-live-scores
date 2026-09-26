import { describe, it, expect } from 'vitest'
import { trainElo, fipPriorElo, type TrainingMatch, type PlayerSnapshot } from '../elo-model.js'

const PLAYERS = new Map<string, PlayerSnapshot>([
  ['a', { id: 'a', name: 'A', ranking: 10, category: 'men' }],
  ['b', { id: 'b', name: 'B', ranking: 10, category: 'men' }],
  ['c', { id: 'c', name: 'C', ranking: 200, category: 'men' }],
  ['d', { id: 'd', name: 'D', ranking: 200, category: 'men' }],
])

function match(id: string, tournamentId: string): TrainingMatch {
  return {
    id,
    tournament_id: tournamentId,
    finished_at: '2026-08-15T12:00:00Z',
    scheduled_at: '2026-08-15T12:00:00Z',
    pair1_player1_id: 'a',
    pair1_player2_id: 'b',
    pair2_player1_id: 'c',
    pair2_player2_id: 'd',
    winner_pair: 2,
  } as TrainingMatch
}

const AS_OF = '2026-09-01T00:00:00Z'

describe('trainElo team-league exclusion', () => {
  it('does not train on a PPL match', () => {
    const levels = new Map([['t-ppl', 'ppl']])
    const result = trainElo([match('m1', 't-ppl')], PLAYERS, levels, AS_OF, 180)
    expect(result.trainedCount).toBe(0)
  })

  it('does not train on a PPL II match', () => {
    const levels = new Map([['t-ppl2', 'ppl_ii']])
    const result = trainElo([match('m1', 't-ppl2')], PLAYERS, levels, AS_OF, 180)
    expect(result.trainedCount).toBe(0)
  })

  it('leaves ratings at their cold-start prior when only league matches exist', () => {
    const levels = new Map([['t-ppl', 'ppl']])
    const result = trainElo([match('m1', 't-ppl')], PLAYERS, levels, AS_OF, 180)
    expect(result.elo.get('a')).toBeUndefined()
    expect(result.elo.get('c')).toBeUndefined()
  })

  it('still trains on circuit matches', () => {
    const levels = new Map([['t-p1', 'p1']])
    const result = trainElo([match('m1', 't-p1')], PLAYERS, levels, AS_OF, 180)
    expect(result.trainedCount).toBe(1)
    expect(result.elo.get('c')!).toBeGreaterThan(fipPriorElo(200))
  })

  it('trains circuit matches in a mixed corpus and skips the league one', () => {
    const levels = new Map([['t-p1', 'p1'], ['t-ppl', 'ppl']])
    const result = trainElo(
      [match('m1', 't-p1'), match('m2', 't-ppl')],
      PLAYERS, levels, AS_OF, 180,
    )
    expect(result.trainedCount).toBe(1)
  })

  it('still trains on an unknown level (deny-list, not allow-list)', () => {
    const levels = new Map([['t-x', 'some_new_tier']])
    const result = trainElo([match('m1', 't-x')], PLAYERS, levels, AS_OF, 180)
    expect(result.trainedCount).toBe(1)
  })
})
