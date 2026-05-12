import { describe, it, expect } from 'vitest'
import { buildMatchSummary, type MatchSummaryInput } from '../match-summary'

const baseMatch: MatchSummaryInput = {
  status: 'finished',
  round: 'Final',
  winner_pair: 1,
  scheduled_at: '2026-05-04T18:00:00Z',
  finished_at: '2026-05-04T19:42:00Z',
  pair1: { names: ['Juan Lebron', 'Ale Galan'] },
  pair2: { names: ['Franco Stupaczuk', 'Martin Di Nenno'] },
  sets: [
    { set_number: 1, pair1_games: 6, pair2_games: 4 },
    { set_number: 2, pair1_games: 7, pair2_games: 5 },
  ],
  tournament: {
    name: 'Premier Padel Buenos Aires P1',
    country: 'Argentina',
    level: 'p1',
  },
}

describe('buildMatchSummary', () => {
  it('produces a one-line headline for a finished match', () => {
    const summary = buildMatchSummary(baseMatch)
    expect(summary.headline).toBe(
      'Lebron / Galan defeated Stupaczuk / Di Nenno 6-4, 7-5 in the Final of Premier Padel Buenos Aires P1',
    )
  })

  it('returns a list of factual sentences for the body', () => {
    const summary = buildMatchSummary(baseMatch)
    expect(summary.facts).toContain('Tournament: Premier Padel Buenos Aires P1 (Argentina)')
    expect(summary.facts).toContain('Round: Final')
    expect(summary.facts.some((f) => f.startsWith('Played on'))).toBe(true)
  })

  it('handles a live match with no winner yet', () => {
    const live: MatchSummaryInput = {
      ...baseMatch,
      status: 'live',
      winner_pair: null,
      finished_at: null,
      sets: [{ set_number: 1, pair1_games: 4, pair2_games: 3 }],
    }
    const summary = buildMatchSummary(live)
    expect(summary.headline).toBe(
      'Lebron / Galan vs Stupaczuk / Di Nenno — live now in the Final of Premier Padel Buenos Aires P1',
    )
  })

  it('omits round when missing', () => {
    const noRound: MatchSummaryInput = { ...baseMatch, round: null }
    const summary = buildMatchSummary(noRound)
    expect(summary.headline).toBe(
      'Lebron / Galan defeated Stupaczuk / Di Nenno 6-4, 7-5 at Premier Padel Buenos Aires P1',
    )
  })

  it('handles a 1-set retirement', () => {
    const retired: MatchSummaryInput = {
      ...baseMatch,
      status: 'retired',
      winner_pair: 1,
      sets: [{ set_number: 1, pair1_games: 6, pair2_games: 2 }],
    }
    const summary = buildMatchSummary(retired)
    expect(summary.headline).toContain('6-2')
    expect(summary.facts.some((f) => f.toLowerCase().includes('retired'))).toBe(true)
  })
})
