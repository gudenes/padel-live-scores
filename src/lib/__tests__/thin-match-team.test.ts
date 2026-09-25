import { describe, it, expect } from 'vitest'
import { hydrateThinPlayers } from '@/lib/thin-match-player'
import { pairName } from '@/types/match'

// A team-league fixture is published before its line-up. Until the pairing is
// named we still know which franchises meet, and "TBD vs TBD" throws that
// away. Measured on Playa del Carmen day 1, which went live reading exactly
// that.

const tie = { home: { team: { name: 'Mexico Waves' } }, away: { team: { name: 'New York Atlantics' } } }

describe('franchise stand-ins', () => {
  it('fills an empty side with its franchise', () => {
    const row = hydrateThinPlayers({ tie } as never) as Record<string, { name?: string; is_team?: boolean } | null>
    expect(row.pair1_player1?.name).toBe('Mexico Waves')
    expect(row.pair2_player1?.name).toBe('New York Atlantics')
    expect(row.pair1_player1?.is_team).toBe(true)
  })

  it('leaves slot 2 empty so the name renders once', () => {
    // Filling both slots would print "Mexico Waves / Mexico Waves".
    const row = hydrateThinPlayers({ tie } as never) as Record<string, unknown>
    expect(row.pair1_player2).toBeFalsy()
  })

  it('NEVER displaces a real player', () => {
    const real = { id: 'p1', name: 'Lucia Peralta' }
    const row = hydrateThinPlayers({ tie, pair1_player1: real } as never) as Record<string, { name?: string } | null>
    expect(row.pair1_player1?.name).toBe('Lucia Peralta')
    // The away side was empty, so it still gets its franchise.
    expect(row.pair2_player1?.name).toBe('New York Atlantics')
  })

  it('never displaces a thin NAME either', () => {
    // Amateur-tier rows carry names without FKs; those win over a franchise.
    const row = hydrateThinPlayers({ tie, pair1_player1_name: 'Some Player' } as never) as Record<string, { name?: string; is_team?: boolean } | null>
    expect(row.pair1_player1?.name).toBe('Some Player')
    expect(row.pair1_player1?.is_team).toBeFalsy()
  })

  it('does nothing on a circuit match, which carries no tie', () => {
    const row = hydrateThinPlayers({} as never) as Record<string, unknown>
    expect(row.pair1_player1).toBeFalsy()
  })
})

describe('pairName with a franchise stand-in', () => {
  it('prints the franchise verbatim', () => {
    // The surname heuristic would turn this into "M. Waves".
    const team = { id: '', name: 'Mexico Waves', is_team: true } as never
    expect(pairName(team, null)).toBe('Mexico Waves')
  })

  it('still shortens real player names', () => {
    const p = { id: 'x', name: 'Lucia Peralta Exposito' } as never
    expect(pairName(p, null)).not.toBe('Lucia Peralta Exposito')
  })

  it('still says TBD when there is nothing at all', () => {
    expect(pairName(null, null)).toBe('TBD')
  })
})
