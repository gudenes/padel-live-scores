import { describe, it, expect } from 'vitest'
import {
  buildMarketRow,
  ACTIVE_TOURNAMENT_STATUS_FILTER,
  TOURNAMENT_STATUSES,
} from '../market-generator.js'
import { priceYes } from '../../lib/lmsr.js'
import { matchRowToCandidate, seedSpecForTemplate, type MatchRow } from '../../lib/market-candidates.js'
import { passesGates, type Gates } from '../../lib/market-gates.js'

const TEMPLATE = {
  id: 'tpl-1',
  key: 'match.winner',
  resolver_key: 'match.winner_is_pair',
  params: { pair: 1 },
  max_loss_guacas: 5000,
  seed_source: 'elo',
  lock_rule: 'match_start' as const,
}

const CANDIDATE = {
  key: 'match.winner:match-1',
  matchId: 'match-1',
  tournamentId: 'tour-1',
  category: 'men' as const,
  round: 'SF',
  bestRanking: 3,
  modelProb: 0.62,
  // For seed_source='elo' these two are the same number by construction —
  // matchRowToCandidate copies the model probability into the anchor.
  seedSource: 'elo',
  seedProb: 0.62,
  scheduledAt: new Date('2026-09-26T18:00:00Z'),
  // Required by Candidate. buildMarketRow never reads it, and tsconfig
  // excludes __tests__ from typecheck, so omitting it would go unnoticed
  // until tests enter the typecheck scope.
  subsidyGuacas: 12000,
}

/** A bagel-style template: no model anchor, a measured base rate in params. */
const FIXED_TEMPLATE = {
  id: 'tpl-2',
  key: 'match.bagel',
  resolver_key: 'match.any_set_bagel',
  params: { seedProb: 0.203 },
  max_loss_guacas: 6000,
  seed_source: 'fixed',
  lock_rule: 'match_start' as const,
}

/** What seedSpecForTemplate + matchRowToCandidate produce for FIXED_TEMPLATE. */
const FIXED_CANDIDATE = {
  ...CANDIDATE,
  key: 'match.bagel:match-1',
  modelProb: null,
  seedSource: 'fixed',
  seedProb: 0.203,
  subsidyGuacas: 6000,
}

describe('tournament status filter', () => {
  it('includes NULL, which is the majority of rows', () => {
    // status.neq.finished alone drops nulls: in SQL, NULL != 'finished' is
    // NULL, not true. 643 of 756 tournaments have a null status.
    expect(ACTIVE_TOURNAMENT_STATUS_FILTER).toContain('status.is.null')
  })

  it('admits pending and live', () => {
    expect(ACTIVE_TOURNAMENT_STATUS_FILTER).toContain('status.eq.pending')
    expect(ACTIVE_TOURNAMENT_STATUS_FILTER).toContain('status.eq.live')
  })

  it('excludes finished', () => {
    expect(ACTIVE_TOURNAMENT_STATUS_FILTER).not.toContain('status.eq.finished')
  })

  it('never reintroduces the statuses that do not exist in this schema', () => {
    // An allow-list of ['live','ongoing','upcoming'] made the generator
    // permanently blind to every tournament that had not started yet.
    expect(ACTIVE_TOURNAMENT_STATUS_FILTER).not.toContain('ongoing')
    expect(ACTIVE_TOURNAMENT_STATUS_FILTER).not.toContain('upcoming')
    expect(TOURNAMENT_STATUSES).not.toContain('ongoing' as never)
    expect(TOURNAMENT_STATUSES).not.toContain('upcoming' as never)
  })
})

describe('buildMarketRow', () => {
  it('derives b from the template ceiling', () => {
    expect(buildMarketRow(TEMPLATE, CANDIDATE, 'season-1').lmsr_b).toBeCloseTo(5000 / Math.LN2, 4)
  })

  it('opens at exactly the model probability', () => {
    const r = buildMarketRow(TEMPLATE, CANDIDATE, 'season-1')
    expect(priceYes(r.q_yes, r.q_no, r.lmsr_b)).toBeCloseTo(0.62, 9)
    expect(r.seed_prob).toBeCloseTo(0.62, 6)
  })

  it('freezes the resolver and its params onto the row', () => {
    const r = buildMarketRow(TEMPLATE, CANDIDATE, 'season-1')
    expect(r.resolver_key).toBe('match.winner_is_pair')
    expect(r.resolver_params).toEqual({ pair: 1 })
  })

  it('locks at the match start for lock_rule=match_start', () => {
    expect(buildMarketRow(TEMPLATE, CANDIDATE, 'season-1').locks_at).toBe('2026-09-26T18:00:00.000Z')
  })

  it('opens the market', () => {
    expect(buildMarketRow(TEMPLATE, CANDIDATE, 'season-1').status).toBe('open')
  })

  it('clamps an extreme model probability away from 0 and 1', () => {
    // seed_prob has a CHECK (> 0 AND < 1); ln(0) would be -Infinity.
    const r = buildMarketRow(TEMPLATE, { ...CANDIDATE, modelProb: 0.9999 }, 'season-1')
    expect(r.seed_prob).toBeLessThan(1)
    expect(Number.isFinite(r.q_yes)).toBe(true)
    expect(Number.isFinite(r.q_no)).toBe(true)
  })

  it('throws when the candidate has no seed probability', () => {
    expect(() =>
      buildMarketRow(TEMPLATE, { ...CANDIDATE, modelProb: null, seedProb: null }, 's'),
    ).toThrow(/seed/i)
  })

  it('throws when the candidate has no scheduled_at', () => {
    expect(() => buildMarketRow(TEMPLATE, { ...CANDIDATE, scheduledAt: null }, 's')).toThrow(/lock/i)
  })
})

describe('buildMarketRow · fixed seed source', () => {
  it('opens at the template constant, with no model probability anywhere', () => {
    const r = buildMarketRow(FIXED_TEMPLATE, FIXED_CANDIDATE, 'season-1')
    expect(r.seed_prob).toBeCloseTo(0.203, 6)
    expect(priceYes(r.q_yes, r.q_no, r.lmsr_b)).toBeCloseTo(0.203, 9)
  })

  it('records seed_source on the row so the API can label the price honestly', () => {
    // /api/play reads this column to decide whether the number is a model
    // prediction or a historical base rate. Losing it here makes the UI show a
    // base rate under an "AI" chip.
    expect(buildMarketRow(FIXED_TEMPLATE, FIXED_CANDIDATE, 'season-1').seed_source).toBe('fixed')
  })

  it('freezes the set-shape resolver and its params onto the row', () => {
    const r = buildMarketRow(FIXED_TEMPLATE, FIXED_CANDIDATE, 'season-1')
    expect(r.resolver_key).toBe('match.any_set_bagel')
    expect(r.resolver_params).toEqual({ seedProb: 0.203 })
  })

  it('does NOT throw just because the model has no opinion', () => {
    // The regression this whole seed_source split exists for: a null modelProb
    // used to be fatal, so a fixed-seed template could never produce a market.
    expect(() => buildMarketRow(FIXED_TEMPLATE, FIXED_CANDIDATE, 'season-1')).not.toThrow()
  })

  it('throws when a fixed template shipped no usable constant', () => {
    expect(() =>
      buildMarketRow(FIXED_TEMPLATE, { ...FIXED_CANDIDATE, seedProb: null }, 's'),
    ).toThrow(/seed/i)
  })
})

// The generator's real pipeline for one candidate, exercised end to end:
//   template row → seedSpecForTemplate → matchRowToCandidate → passesGates →
//   buildMarketRow.
// Every earlier test stubs one of those links; this one proves the chain does
// not drop a fixed-seed candidate at any point in it, which is the exact
// failure mode that produced a clean, plausible zero.
describe('template → candidate → gate → row', () => {
  const MATCH: MatchRow = {
    id: 'match-1',
    tournament_id: 'tour-1',
    category: 'men',
    round: 'Round of 16',
    round_canonical: 'R16',
    scheduled_at: '2026-09-26T18:00:00Z',
    pred_pair1_prob: '0.62',
    pair1_player1_id: 'p1',
    pair1_player2_id: 'p2',
    pair2_player1_id: 'p3',
    pair2_player2_id: 'p4',
  }
  const RANKS = new Map([['p1', 3], ['p2', 8], ['p3', 22], ['p4', 60]])

  /** The gates the migration ships for match.bagel — main draw, no band. */
  const BAGEL_GATES: Gates = { rounds: ['R64', 'R32', 'R16', 'QF', 'SF', 'F'] }

  function pipeline(
    template: { key: string; seed_source: string; params: Record<string, unknown>; max_loss_guacas: number },
    gates: Gates,
  ) {
    const seed = seedSpecForTemplate(template)
    const cand = matchRowToCandidate(MATCH, RANKS, template.key, template.max_loss_guacas, seed)
    return { cand, gate: passesGates(cand, gates) }
  }

  it('carries a bagel candidate all the way to an opened market row', () => {
    const { cand, gate } = pipeline(FIXED_TEMPLATE, BAGEL_GATES)
    expect(gate).toEqual({ ok: true })
    const row = buildMarketRow(FIXED_TEMPLATE, cand, 'season-1')
    expect(row.seed_prob).toBeCloseTo(0.203, 6)
    expect(row.seed_source).toBe('fixed')
    expect(row.status).toBe('open')
  })

  it('still carries a winner candidate through unchanged', () => {
    const { cand, gate } = pipeline(
      { ...TEMPLATE, max_loss_guacas: 12000 },
      { rounds: ['R16'], minRanking: 50, competitiveness: [0.35, 0.65] },
    )
    expect(gate).toEqual({ ok: true })
    expect(buildMarketRow(TEMPLATE, cand, 'season-1').seed_prob).toBeCloseTo(0.62, 6)
  })

  it('and still drops a winner candidate the model calls a foregone conclusion', () => {
    const seed = seedSpecForTemplate(TEMPLATE)
    const cand = matchRowToCandidate(
      { ...MATCH, pred_pair1_prob: '0.93' }, RANKS, TEMPLATE.key, 12000, seed,
    )
    expect(passesGates(cand, { rounds: ['R16'], competitiveness: [0.35, 0.65] }))
      .toEqual({ ok: false, reason: 'outside competitiveness band' })
  })
})
