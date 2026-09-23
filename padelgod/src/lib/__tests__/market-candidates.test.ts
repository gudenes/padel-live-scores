import { describe, it, expect } from 'vitest'
import { matchRowToCandidate, type MatchRow } from '../market-candidates.js'

function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-1', tournament_id: 'tour-1', category: 'men', round: 'SF',
    scheduled_at: '2026-09-26T18:00:00Z', pred_pair1_prob: '0.62',
    pair1_player1_id: 'p1', pair1_player2_id: 'p2',
    pair2_player1_id: 'p3', pair2_player2_id: 'p4',
    ...over,
  }
}

const RANKS = new Map([['p1', 3], ['p2', 8], ['p3', 22], ['p4', 60]])

describe('matchRowToCandidate', () => {
  it('maps the happy path', () => {
    const c = matchRowToCandidate(row(), RANKS, 'match.winner', 12000)
    expect(c.key).toBe('match.winner:match-1')
    expect(c.matchId).toBe('match-1')
    expect(c.tournamentId).toBe('tour-1')
    expect(c.round).toBe('SF')
    expect(c.modelProb).toBeCloseTo(0.62, 6)
  })
  it('coerces pred_pair1_prob from the string PostgREST returns', () => {
    expect(matchRowToCandidate(row({ pred_pair1_prob: '0.34' }), RANKS, 't', 12000).modelProb).toBeCloseTo(0.34, 6)
  })
  it('uses the best (lowest) ranking across all four players', () => {
    expect(matchRowToCandidate(row(), RANKS, 't', 12000).bestRanking).toBe(3)
  })
  it('ignores unranked players when finding the best ranking', () => {
    expect(matchRowToCandidate(row(), new Map([['p3', 22]]), 't', 12000).bestRanking).toBe(22)
  })
  it('reports a fully unranked field as null, not Infinity', () => {
    expect(matchRowToCandidate(row(), new Map(), 't', 12000).bestRanking).toBeNull()
  })
  it('reports a missing prediction as null rather than NaN', () => {
    expect(matchRowToCandidate(row({ pred_pair1_prob: null }), RANKS, 't', 12000).modelProb).toBeNull()
  })
  it('reports a missing scheduled_at as null', () => {
    expect(matchRowToCandidate(row({ scheduled_at: null }), RANKS, 't', 12000).scheduledAt).toBeNull()
  })
  it('parses scheduled_at into a Date', () => {
    expect(matchRowToCandidate(row(), RANKS, 't', 12000).scheduledAt?.toISOString()).toBe('2026-09-26T18:00:00.000Z')
  })
  it('carries the template subsidy onto the candidate', () => {
    expect(matchRowToCandidate(row(), RANKS, 't', 12000).subsidyGuacas).toBe(12000)
  })
})
