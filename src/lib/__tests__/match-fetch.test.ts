import { describe, it, expect } from 'vitest'
import { normalizeFetchedMatch } from '../match-fetch'

describe('normalizeFetchedMatch', () => {
  it('sorts sets by set_number and games by game_number', () => {
    const m = normalizeFetchedMatch({
      id: 'm1',
      sets: [
        { set_number: 2, games: [{ game_number: 3 }, { game_number: 1 }] },
        { set_number: 1, games: [{ game_number: 2 }, { game_number: 1 }] },
      ],
    }) as unknown as { sets: Array<{ set_number: number; games: Array<{ game_number: number }> }> }
    expect(m.sets.map((s) => s.set_number)).toEqual([1, 2])
    expect(m.sets[0]!.games.map((g) => g.game_number)).toEqual([1, 2])
    expect(m.sets[1]!.games.map((g) => g.game_number)).toEqual([1, 3])
  })

  it('tolerates missing sets/games', () => {
    const m = normalizeFetchedMatch({ id: 'm2' }) as unknown as { sets: unknown[] }
    expect(m.sets).toEqual([])
  })

  it('hydrates thin player slots from fallback name columns', () => {
    const m = normalizeFetchedMatch({
      id: 'm3', sets: [],
      pair1_player1: null, pair1_player1_name: 'Ana Perez',
    }) as unknown as { pair1_player1: { id: string; name: string } }
    expect(m.pair1_player1.id).toBe('')
    expect(m.pair1_player1.name).toBe('Ana Perez')
  })
})
