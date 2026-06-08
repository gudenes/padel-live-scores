import { describe, it, expect } from 'vitest'
import { buildTournamentResults, type TournamentResultMatchInput } from '../tournament-results'

function match(over: Partial<TournamentResultMatchInput>): TournamentResultMatchInput {
  return {
    id: 'm1',
    status: 'finished',
    round: 'Final',
    category: 'men',
    winner_pair: 1,
    finished_at: '2026-05-01T18:00:00Z',
    scheduled_at: '2026-05-01T16:00:00Z',
    pair1: [{ id: 'p1', name: 'Agustín Tapia' }, { id: 'p2', name: 'Arturo Coello' }],
    pair2: [{ id: 'p3', name: 'Alejandro Galán' }, { id: 'p4', name: 'Federico Chingotto' }],
    sets: [
      { set_number: 1, pair1_games: 6, pair2_games: 3 },
      { set_number: 2, pair1_games: 7, pair2_games: 5 },
    ],
    ...over,
  }
}

describe('buildTournamentResults', () => {
  it('builds a "beat" headline with score for a finished match', () => {
    const { rows, finishedCount } = buildTournamentResults([match({})])
    expect(finishedCount).toBe(1)
    expect(rows[0].headline).toBe('Tapia / Coello beat Galán / Chingotto 6-3, 7-5')
    expect(rows[0].pair1.won).toBe(true)
    expect(rows[0].pair2.won).toBe(false)
    expect(rows[0].score).toBe('6-3, 7-5')
  })

  it('orders finished (newest first) before upcoming (soonest first)', () => {
    const older = match({ id: 'old', finished_at: '2026-04-01T10:00:00Z' })
    const newer = match({ id: 'new', finished_at: '2026-05-10T10:00:00Z' })
    const future = match({
      id: 'fut', status: 'scheduled', winner_pair: null,
      finished_at: null, scheduled_at: '2026-06-01T10:00:00Z',
    })
    const { rows } = buildTournamentResults([older, future, newer])
    expect(rows.map((r) => r.id)).toEqual(['new', 'old', 'fut'])
  })

  it('renders scheduled matches as "vs" with no score', () => {
    const { rows, upcomingCount } = buildTournamentResults([
      match({ status: 'scheduled', winner_pair: null, sets: [] }),
    ])
    expect(upcomingCount).toBe(1)
    expect(rows[0].headline).toBe('Tapia / Coello vs Galán / Chingotto')
    expect(rows[0].score).toBeNull()
  })

  it('drops matches missing player names on a side', () => {
    const { rows } = buildTournamentResults([match({ pair2: [{ id: null, name: '' }] })])
    expect(rows).toHaveLength(0)
  })

  it('filters by category when requested', () => {
    const men = match({ id: 'men', category: 'men' })
    const women = match({ id: 'wom', category: 'women' })
    const { rows } = buildTournamentResults([men, women], { category: 'women' })
    expect(rows.map((r) => r.id)).toEqual(['wom'])
  })

  it('trusts winner_pair for retired matches and omits the mid-match score', () => {
    const { rows } = buildTournamentResults([
      match({ status: 'retired', winner_pair: 2, sets: [{ set_number: 1, pair1_games: 6, pair2_games: 4 }] }),
    ])
    // winner_pair=2 wins by retirement even though pair1 led on games; score
    // omitted, status suffix carries the meaning.
    expect(rows[0].headline).toBe('Galán / Chingotto beat Tapia / Coello (retired)')
    expect(rows[0].pair2.won).toBe(true)
  })

  it('derives the winner from sets when winner_pair contradicts the games', () => {
    // Stale/inverted winner_pair=1, but the games show pair2 winning both sets.
    const { rows } = buildTournamentResults([
      match({
        winner_pair: 1,
        sets: [
          { set_number: 1, pair1_games: 6, pair2_games: 7 },
          { set_number: 2, pair1_games: 3, pair2_games: 6 },
        ],
      }),
    ])
    // Winner derived as pair2; score oriented to the winner (7-6, 6-3).
    expect(rows[0].headline).toBe('Galán / Chingotto beat Tapia / Coello 7-6, 6-3')
    expect(rows[0].pair2.won).toBe(true)
  })

  it('falls back to "vs" for a finished match with no decisive set winner', () => {
    const { rows } = buildTournamentResults([
      match({ winner_pair: 1, sets: [{ set_number: 1, pair1_games: 6, pair2_games: 6 }] }),
    ])
    expect(rows[0].headline).toBe('Tapia / Coello vs Galán / Chingotto')
    expect(rows[0].pair1.won).toBe(false)
    expect(rows[0].pair2.won).toBe(false)
  })
})
