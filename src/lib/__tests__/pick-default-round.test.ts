import { describe, it, expect } from 'vitest'
import { pickDefaultRound, type PickDefaultRoundMatch } from '../pick-default-round'

const ROUNDS = ['Q1', 'Q2', 'Q3', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Finals']

function m(
  round: string,
  status: string,
  scheduledDateKey: string | null = null,
  tournamentId: string | null = 't1',
): PickDefaultRoundMatch {
  return { normalizedRound: round, status, scheduledDateKey, tournamentId }
}

describe('pickDefaultRound', () => {
  it('returns null when there are no available rounds', () => {
    expect(
      pickDefaultRound({
        availableRounds: [],
        matches: [],
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBeNull()
  })

  it('picks the most-advanced round with a live match', () => {
    const matches = [
      m('Q1', 'live'),
      m('Round of 16', 'live'),
      m('Round of 32', 'finished'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Round of 16')
  })

  it('treats on_court the same as live', () => {
    const matches = [m('Quarterfinals', 'on_court')]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Quarterfinals')
  })

  it('falls back to the most-advanced round scheduled today when nothing is live', () => {
    const matches = [
      m('Q3', 'finished', '2026-05-22'),
      m('Round of 32', 'scheduled', '2026-05-23'),
      m('Round of 16', 'scheduled', '2026-05-23'),
      m('Quarterfinals', 'scheduled', '2026-05-24'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Round of 16')
  })

  it('falls back to the most-advanced finished round when nothing is live or today', () => {
    const matches = [
      m('Q1', 'finished', '2026-05-20'),
      m('Q2', 'finished', '2026-05-21'),
      m('Q3', 'finished', '2026-05-21'),
      m('Round of 32', 'scheduled', '2026-05-25'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q3')
  })

  it('live action beats most-advanced finished — late quals while R32 has only finished matches', () => {
    const matches = [
      m('Q3', 'live'),
      m('Round of 32', 'finished'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q3')
  })

  it('live action beats most-advanced scheduled-today — late quals while R16 only has future-today matches', () => {
    const matches = [
      m('Q3', 'live'),
      m('Round of 16', 'scheduled', '2026-05-23'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q3')
  })

  it('falls back to availableRounds[0] when the tournament has no live/today/finished matches', () => {
    const matches = [
      m('Q1', 'scheduled', '2026-05-25'),
      m('Q2', 'scheduled', '2026-05-25'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q1')
  })

  it('filters matches by activeTournamentId when provided', () => {
    const matches = [
      m('Round of 16', 'live', null, 'OTHER'),
      m('Q3', 'live', null, 't1'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q3')
  })

  it('ignores activeTournamentId filter when null (all-tournaments mode)', () => {
    const matches = [
      m('Round of 16', 'live', null, 'OTHER'),
      m('Q3', 'live', null, 't1'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: null,
        todayKey: '2026-05-23',
      }),
    ).toBe('Round of 16')
  })

  it('ignores rounds not present in availableRounds', () => {
    const matches = [m('Finals', 'live')]
    expect(
      pickDefaultRound({
        availableRounds: ['Q1', 'Q2'],
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q1')
  })
})
