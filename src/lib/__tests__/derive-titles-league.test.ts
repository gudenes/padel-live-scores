import { describe, it, expect } from 'vitest'
import { deriveTitles, type MatchRowForTitles } from '../derive-titles'

const PLAYER = 'p1'

function final(tournamentId: string, level: string): MatchRowForTitles {
  return {
    id: `m-${tournamentId}`,
    round: 'F',
    status: 'finished',
    winner_pair: 1,
    finished_at: '2026-08-16T18:00:00Z',
    scheduled_at: '2026-08-16T16:00:00Z',
    pair1_player1: { id: PLAYER, name: 'Player One' },
    pair1_player2: { id: 'p2', name: 'Player Two' },
    pair2_player1: { id: 'p3', name: 'Player Three' },
    pair2_player2: { id: 'p4', name: 'Player Four' },
    tournament: { id: tournamentId, name: `T ${tournamentId}`, level },
  } as MatchRowForTitles
}

describe('deriveTitles team-league exclusion', () => {
  it('does not count a PPL final as a title', () => {
    expect(deriveTitles([final('t1', 'ppl')], PLAYER)).toHaveLength(0)
  })

  it('does not count a PPL II final as a title', () => {
    expect(deriveTitles([final('t1', 'ppl_ii')], PLAYER)).toHaveLength(0)
  })

  it('still counts a circuit final', () => {
    const titles = deriveTitles([final('t1', 'p1')], PLAYER)
    expect(titles).toHaveLength(1)
    expect(titles[0].tournamentLevel).toBe('p1')
  })

  it('counts only the circuit final in a mixed list', () => {
    const titles = deriveTitles([final('t1', 'ppl'), final('t2', 'major')], PLAYER)
    expect(titles).toHaveLength(1)
    expect(titles[0].tournamentId).toBe('t2')
  })

  it('still counts a final whose level is null', () => {
    expect(deriveTitles([final('t1', null as unknown as string)], PLAYER)).toHaveLength(1)
  })
})
