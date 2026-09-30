import { describe, it, expect } from 'vitest'
import {
  fixedSeedProb,
  matchRowToCandidate,
  seedSpecForTemplate,
  type MatchRow,
} from '../market-candidates.js'

function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-1', tournament_id: 'tour-1', category: 'men',
    round: 'Semifinals',      // free-text, as upstream actually writes it
    round_canonical: 'SF',    // normalised — this is what the gate must see
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
  it('reads round_canonical, never the free-text round', () => {
    // matches.round spells finals as 'Finals' AND 'Final'; a gate on ["SF","F"]
    // compared against it matches nothing, permanently.
    const c = matchRowToCandidate(row({ round: 'Final', round_canonical: 'F' }), RANKS, 't', 12000)
    expect(c.round).toBe('F')
  })

  it('reports a null round_canonical as null', () => {
    expect(matchRowToCandidate(row({ round_canonical: null }), RANKS, 't', 12000).round).toBeNull()
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

  it('defaults to the elo seed, anchoring on the model probability', () => {
    const c = matchRowToCandidate(row(), RANKS, 't', 12000)
    expect(c.seedSource).toBe('elo')
    expect(c.seedProb).toBeCloseTo(0.62, 6)
    expect(c.modelProb).toBeCloseTo(0.62, 6)
  })

  it('reports no anchor when an elo template has no prediction to anchor on', () => {
    const c = matchRowToCandidate(row({ pred_pair1_prob: null }), RANKS, 't', 12000)
    expect(c.seedProb).toBeNull()
  })
})

describe('matchRowToCandidate · fixed seed source', () => {
  const FIXED = { source: 'fixed', fixedProb: 0.203 }

  it('anchors on the template constant, not on pred_pair1_prob', () => {
    const c = matchRowToCandidate(row(), RANKS, 'match.bagel', 12000, FIXED)
    expect(c.seedProb).toBeCloseTo(0.203, 6)
    expect(c.seedSource).toBe('fixed')
  })

  it('DROPS the model probability — it answers a different question', () => {
    // pred_pair1_prob is 0.62 that PAIR 1 WINS. Carrying it onto a bagel market
    // would band and score a set-shape question on a winner probability.
    expect(matchRowToCandidate(row(), RANKS, 'match.bagel', 12000, FIXED).modelProb).toBeNull()
  })

  it('anchors even when the match carries no prediction at all', () => {
    const c = matchRowToCandidate(row({ pred_pair1_prob: null }), RANKS, 'm', 12000, FIXED)
    expect(c.seedProb).toBeCloseTo(0.203, 6)
    expect(c.modelProb).toBeNull()
  })
})

describe('fixedSeedProb', () => {
  it('reads a probability out of params', () => {
    expect(fixedSeedProb({ seedProb: 0.203 })).toBeCloseTo(0.203, 6)
  })
  it('coerces the string a jsonb round-trip can produce', () => {
    expect(fixedSeedProb({ seedProb: '0.206' })).toBeCloseTo(0.206, 6)
  })
  it('rejects values the seed_prob CHECK would reject', () => {
    // seed_prob has CHECK (> 0 AND < 1), and seedShares takes ln() of it.
    expect(fixedSeedProb({ seedProb: 0 })).toBeNull()
    expect(fixedSeedProb({ seedProb: 1 })).toBeNull()
    expect(fixedSeedProb({ seedProb: 20 })).toBeNull()
    expect(fixedSeedProb({ seedProb: -0.2 })).toBeNull()
  })
  it('reads a missing or malformed param as absent rather than as NaN', () => {
    expect(fixedSeedProb({})).toBeNull()
    expect(fixedSeedProb(null)).toBeNull()
    expect(fixedSeedProb({ seedProb: 'twenty percent' })).toBeNull()
  })
})

describe('seedSpecForTemplate', () => {
  it('reads params.seedProb only for a fixed template', () => {
    expect(seedSpecForTemplate({ seed_source: 'fixed', params: { seedProb: 0.203 } }))
      .toEqual({ source: 'fixed', fixedProb: 0.203 })
  })
  it('never lets a stray seedProb leak into an elo template', () => {
    expect(seedSpecForTemplate({ seed_source: 'elo', params: { seedProb: 0.203, pair: 1 } }))
      .toEqual({ source: 'elo', fixedProb: null })
  })
})
