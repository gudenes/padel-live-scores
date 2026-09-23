import { describe, it, expect } from 'vitest'
import { applyCaps, type Candidate, type Caps } from '../market-gates.js'

function c(key: string, over: Partial<Candidate> = {}): Candidate {
  return {
    key, matchId: `match-${key}`, tournamentId: 'tour-1', category: 'men',
    round: 'SF', bestRanking: 5, modelProb: 0.5,
    scheduledAt: new Date('2026-09-26T18:00:00Z'), subsidyGuacas: 5_000, ...over,
  }
}

const CAPS: Caps = {
  maxOpenMarkets: 15, currentOpen: 0,
  maxNewPerDay: 20, createdToday: 0,
  maxPerMatch: 3, existingPerMatch: {},
  maxPerTournamentDay: 8, createdPerTournamentToday: {},
  maxSubsidyPerDay: 250_000, subsidyUsedToday: 0,
}

describe('applyCaps', () => {
  it('keeps everything when nothing binds', () => {
    const r = applyCaps([c('a'), c('b')], CAPS)
    expect(r.kept.map(k => k.key)).toEqual(['a', 'b'])
    expect(r.drops).toEqual([])
  })

  it('keeps the highest-scoring candidates when the global cap binds', () => {
    const cands = [c('boring', { modelProb: 0.64 }), c('close', { modelProb: 0.50 })]
    const r = applyCaps(cands, { ...CAPS, maxOpenMarkets: 1, currentOpen: 0 })
    expect(r.kept.map(k => k.key)).toEqual(['close'])
    expect(r.drops).toEqual([{ reason: 'over global open cap', count: 1 }])
  })

  it('counts markets already open against the global cap', () => {
    const r = applyCaps([c('a'), c('b')], { ...CAPS, maxOpenMarkets: 15, currentOpen: 14 })
    expect(r.kept).toHaveLength(1)
    expect(r.drops).toEqual([{ reason: 'over global open cap', count: 1 }])
  })

  it('enforces the per-match cap including markets that already exist', () => {
    const same = [c('a', { matchId: 'm1' }), c('b', { matchId: 'm1' })]
    const r = applyCaps(same, { ...CAPS, maxPerMatch: 3, existingPerMatch: { m1: 2 } })
    expect(r.kept).toHaveLength(1)
    expect(r.drops).toEqual([{ reason: 'over per-match cap', count: 1 }])
  })

  it('enforces the per-tournament-per-day cap', () => {
    const r = applyCaps([c('a'), c('b'), c('c')], {
      ...CAPS, maxPerTournamentDay: 8, createdPerTournamentToday: { 'tour-1': 6 },
    })
    expect(r.kept).toHaveLength(2)
    expect(r.drops).toEqual([{ reason: 'over per-tournament daily cap', count: 1 }])
  })

  it('enforces the daily subsidy budget', () => {
    const r = applyCaps([c('a'), c('b'), c('c')], {
      ...CAPS, maxSubsidyPerDay: 10_000, subsidyUsedToday: 0,
    })
    expect(r.kept).toHaveLength(2)
    expect(r.drops).toEqual([{ reason: 'over daily subsidy budget', count: 1 }])
  })

  it('counts each candidate at its own subsidy, not a flat rate', () => {
    // match.winner is seeded at 12,000 and tournament.outright at 40,000.
    // A flat-rate cap let 20 markets look like 40% of a 250k budget when they
    // were really 96% of it.
    const cands = [
      c('cheap', { subsidyGuacas: 5_000 }),
      c('dear', { subsidyGuacas: 40_000 }),
    ]
    const r = applyCaps(cands, { ...CAPS, maxSubsidyPerDay: 30_000, subsidyUsedToday: 0 })
    expect(r.kept.map(k => k.key)).toEqual(['cheap'])
    expect(r.drops).toEqual([{ reason: 'over daily subsidy budget', count: 1 }])
  })

  it('respects subsidy already committed today', () => {
    const r = applyCaps([c('a', { subsidyGuacas: 12_000 })], {
      ...CAPS, maxSubsidyPerDay: 250_000, subsidyUsedToday: 240_000,
    })
    expect(r.kept).toEqual([])
    expect(r.drops).toEqual([{ reason: 'over daily subsidy budget', count: 1 }])
  })

  it('aggregates drop reasons rather than listing one row per candidate', () => {
    const r = applyCaps([c('a'), c('b'), c('c'), c('d')], { ...CAPS, maxNewPerDay: 2, createdToday: 0 })
    expect(r.drops).toEqual([{ reason: 'over daily new-market cap', count: 2 }])
  })

  it('returns an empty result without throwing when every cap is exhausted', () => {
    const r = applyCaps([c('a')], { ...CAPS, maxOpenMarkets: 0 })
    expect(r.kept).toEqual([])
    expect(r.drops).toEqual([{ reason: 'over global open cap', count: 1 }])
  })
})
