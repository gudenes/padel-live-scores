import { describe, it, expect } from 'vitest'
import { pickCurrentTournamentMatch } from '../current-tournament-match'

const NOW = new Date('2026-06-02T13:00:00Z')

// Minimal rows satisfying CurrentMatchCandidate; `id` is carried through so we
// can assert which row was selected.
type Row = {
  id: string
  status: string
  scheduled_at: string | null
  tournament: { starts_at: string | null; ends_at: string | null } | null
}

const inProgressTourn = { starts_at: '2026-05-31T00:00:00Z', ends_at: '2026-06-07T00:00:00Z' }
const futureTourn = { starts_at: '2026-06-08T00:00:00Z', ends_at: '2026-06-14T00:00:00Z' }

describe('pickCurrentTournamentMatch', () => {
  it('selects a scheduled match with null time in an in-progress tournament (Bergamini case)', () => {
    const rows: Row[] = [
      { id: 'r32', status: 'scheduled', scheduled_at: null, tournament: inProgressTourn },
      { id: 'old', status: 'finished', scheduled_at: '2026-05-27T16:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('r32')
  })

  it('returns null when the player only has finished matches in the in-progress tournament (eliminated)', () => {
    const rows: Row[] = [
      { id: 'lost', status: 'finished', scheduled_at: '2026-06-01T16:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)).toBeNull()
  })

  it('does not select a scheduled match in a not-yet-started tournament (left to Tier-1)', () => {
    const rows: Row[] = [
      { id: 'future', status: 'scheduled', scheduled_at: '2026-06-09T16:00:00Z', tournament: futureTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)).toBeNull()
  })

  it('prefers a live match over a scheduled one when both are in progress', () => {
    const rows: Row[] = [
      { id: 'sched', status: 'scheduled', scheduled_at: '2026-06-02T18:00:00Z', tournament: inProgressTourn },
      { id: 'live', status: 'live', scheduled_at: '2026-06-02T12:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('live')
  })

  it('treats a null ends_at as in-progress when started', () => {
    const rows: Row[] = [
      { id: 'noend', status: 'scheduled', scheduled_at: null, tournament: { starts_at: '2026-05-31T00:00:00Z', ends_at: null } },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('noend')
  })

  it('orders scheduled matches by soonest time, null time last', () => {
    const rows: Row[] = [
      { id: 'notime', status: 'scheduled', scheduled_at: null, tournament: inProgressTourn },
      { id: 'soon', status: 'scheduled', scheduled_at: '2026-06-02T15:00:00Z', tournament: inProgressTourn },
      { id: 'later', status: 'scheduled', scheduled_at: '2026-06-02T20:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('soon')
  })

  it('selects an on_court match in an in-progress tournament', () => {
    const rows: Row[] = [
      { id: 'sched', status: 'scheduled', scheduled_at: '2026-06-02T18:00:00Z', tournament: inProgressTourn },
      { id: 'oncourt', status: 'on_court', scheduled_at: '2026-06-02T12:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('oncourt')
  })

  it('skips rows with a null tournament', () => {
    const rows: Row[] = [
      { id: 'notourn', status: 'scheduled', scheduled_at: null, tournament: null },
      { id: 'valid', status: 'scheduled', scheduled_at: null, tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('valid')
  })
})
