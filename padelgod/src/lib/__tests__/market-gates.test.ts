import { describe, it, expect } from 'vitest'
import { passesGates, scoreCandidate, type Candidate, type Gates } from '../market-gates.js'

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    key: 'c1',
    matchId: 'match-1',
    tournamentId: null,
    category: 'men',
    round: 'SF',
    bestRanking: 4,
    modelProb: 0.55,
    seedSource: 'elo',
    seedProb: 0.55,
    scheduledAt: new Date('2026-09-26T18:00:00Z'),
    subsidyGuacas: 5000,
    ...over,
  }
}

/**
 * A candidate from a fixed-seed template: no model opinion at all, and an
 * anchor that came from the template's params rather than from the match.
 */
function fixedCandidate(over: Partial<Candidate> = {}): Candidate {
  return candidate({ seedSource: 'fixed', modelProb: null, seedProb: 0.203, ...over })
}

const GATES: Gates = { rounds: ['SF', 'F'], minRanking: 50, competitiveness: [0.35, 0.65] }

describe('passesGates', () => {
  it('passes a candidate meeting every gate', () => {
    expect(passesGates(candidate(), GATES)).toEqual({ ok: true })
  })
  it('rejects a round outside the gate', () => {
    expect(passesGates(candidate({ round: 'R16' }), GATES)).toEqual({ ok: false, reason: 'below round gate' })
  })
  it('treats a null round as failing the round gate', () => {
    expect(passesGates(candidate({ round: null }), GATES).ok).toBe(false)
  })
  it('rejects when no player is inside the ranking gate', () => {
    expect(passesGates(candidate({ bestRanking: 120 }), GATES)).toEqual({ ok: false, reason: 'no top-50 player' })
  })
  it('treats an unranked field as failing the ranking gate', () => {
    expect(passesGates(candidate({ bestRanking: null }), GATES).ok).toBe(false)
  })
  it('rejects a foregone conclusion', () => {
    expect(passesGates(candidate({ modelProb: 0.92 }), GATES)).toEqual({ ok: false, reason: 'outside competitiveness band' })
  })
  it('rejects a foregone conclusion on the other side too', () => {
    expect(passesGates(candidate({ modelProb: 0.08 }), GATES).ok).toBe(false)
  })
  it('rejects a missing model probability — no anchor, no market', () => {
    // An elo candidate with no prediction has no anchor either:
    // matchRowToCandidate sets seedProb FROM modelProb for seed_source='elo',
    // so the two go null together.
    expect(passesGates(candidate({ modelProb: null, seedProb: null }), GATES))
      .toEqual({ ok: false, reason: 'no seed price available' })
  })
  it('rejects a missing scheduled_at — the market could never lock', () => {
    expect(passesGates(candidate({ scheduledAt: null }), GATES)).toEqual({ ok: false, reason: 'no scheduled_at' })
  })
  it('applies only the gates that are specified', () => {
    expect(passesGates(candidate({ round: 'R64', bestRanking: 900 }), {}).ok).toBe(true)
  })
})

// These are the regression tests for the failure this whole seed_source split
// exists to prevent: the gate used to reject on `modelProb === null`, so every
// non-winner template produced zero markets and reported it as "no seed price
// available" — a clean, plausible zero that looks exactly like "nothing to do".
describe('passesGates · fixed seed source', () => {
  const FIXED_GATES: Gates = { rounds: ['R64', 'R32', 'R16', 'QF', 'SF', 'F'] }

  it('KEEPS a fixed-seed candidate that has no model probability at all', () => {
    expect(passesGates(fixedCandidate(), FIXED_GATES)).toEqual({ ok: true })
  })

  it('does not apply the competitiveness band to it', () => {
    // 0.203 is far outside [0.35,0.65]. The band is a winner-market idea; a
    // base rate is the same number on every match, so banding it would reject
    // every candidate the template ever produced.
    expect(passesGates(fixedCandidate(), { ...FIXED_GATES, competitiveness: [0.35, 0.65] }))
      .toEqual({ ok: true })
  })

  it('still rejects a fixed-seed template that forgot its params.seedProb', () => {
    // A template declaring seed_source='fixed' with no usable constant has no
    // anchor either — it must be dropped loudly, not seeded at 50/50.
    expect(passesGates(fixedCandidate({ seedProb: null }), FIXED_GATES))
      .toEqual({ ok: false, reason: 'no seed price available' })
  })

  it('still applies the round and ranking gates', () => {
    expect(passesGates(fixedCandidate({ round: 'Q1' }), FIXED_GATES).ok).toBe(false)
    expect(passesGates(fixedCandidate({ bestRanking: 900 }), { ...FIXED_GATES, minRanking: 50 }).ok)
      .toBe(false)
  })

  it('still requires a lock time', () => {
    expect(passesGates(fixedCandidate({ scheduledAt: null }), FIXED_GATES))
      .toEqual({ ok: false, reason: 'no scheduled_at' })
  })

  // The elo path must be untouched by all of the above.
  it('leaves the elo path banding exactly as before', () => {
    expect(passesGates(candidate({ modelProb: 0.92, seedProb: 0.92 }), GATES))
      .toEqual({ ok: false, reason: 'outside competitiveness band' })
    expect(passesGates(candidate({ modelProb: 0.08, seedProb: 0.08 }), GATES).ok).toBe(false)
    expect(passesGates(candidate(), GATES)).toEqual({ ok: true })
  })
})

describe('scoreCandidate', () => {
  it('ranks a final above a semi-final', () => {
    expect(scoreCandidate(candidate({ round: 'F' }))).toBeGreaterThan(scoreCandidate(candidate({ round: 'SF' })))
  })
  it('ranks a better-ranked field higher', () => {
    expect(scoreCandidate(candidate({ bestRanking: 1 }))).toBeGreaterThan(scoreCandidate(candidate({ bestRanking: 40 })))
  })
  it('ranks a coin-flip above a lopsided match', () => {
    expect(scoreCandidate(candidate({ modelProb: 0.50 }))).toBeGreaterThan(scoreCandidate(candidate({ modelProb: 0.64 })))
  })
  it('is deterministic', () => {
    expect(scoreCandidate(candidate())).toBe(scoreCandidate(candidate()))
  })
})

// Match-day rollout: all main-draw rounds, retaining the existing quality gates.
describe('main-draw winner eligibility', () => {
  const gates: Gates = { rounds: ['R128','R64','R32','R16','QF','SF','F'], minRanking: 50, competitiveness: [.15,.85] }
  it.each(['R128','R64','R32','R16','QF','SF','F'])('accepts %s', round => {
    expect(passesGates(candidate({ round }), gates).ok).toBe(true)
  })
  it.each(['Q1','Q2','Q3','Q',null])('excludes qualifying/unknown round %s', round => {
    expect(passesGates(candidate({ round }), gates).ok).toBe(false)
  })
  it('still requires prices, a schedule and ranking/competitiveness eligibility', () => {
    for (const patch of [{ seedProb: null }, { scheduledAt: null }, { bestRanking: 90 }, { modelProb: .99 }]) {
      expect(passesGates(candidate({ round: 'R32', ...patch }), gates).ok).toBe(false)
    }
  })
})
