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
    scheduledAt: new Date('2026-09-26T18:00:00Z'),
    subsidyGuacas: 5000,
    ...over,
  }
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
    expect(passesGates(candidate({ modelProb: null }), GATES)).toEqual({ ok: false, reason: 'no seed price available' })
  })
  it('rejects a missing scheduled_at — the market could never lock', () => {
    expect(passesGates(candidate({ scheduledAt: null }), GATES)).toEqual({ ok: false, reason: 'no scheduled_at' })
  })
  it('applies only the gates that are specified', () => {
    expect(passesGates(candidate({ round: 'R64', bestRanking: 900 }), {}).ok).toBe(true)
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
