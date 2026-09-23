import { describe, it, expect } from 'vitest'
import { buildMarketRow } from '../market-generator.js'
import { priceYes } from '../../lib/lmsr.js'

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
  scheduledAt: new Date('2026-09-26T18:00:00Z'),
}

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

  it('throws when the candidate has no model probability', () => {
    expect(() => buildMarketRow(TEMPLATE, { ...CANDIDATE, modelProb: null }, 's')).toThrow(/seed/i)
  })

  it('throws when the candidate has no scheduled_at', () => {
    expect(() => buildMarketRow(TEMPLATE, { ...CANDIDATE, scheduledAt: null }, 's')).toThrow(/lock/i)
  })
})
