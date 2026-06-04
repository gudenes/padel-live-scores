// apps/ops/src/app/(app)/today/_lib/scoreboard-data.test.ts
import { describe, it, expect } from 'vitest'
import { shortName, displayName, mapLiveRowToMatch, isUpcomingStatus, mapFinishedRowToMatch, predictionCorrect } from './scoreboard-data'

describe('shortName', () => {
  it('returns the last token', () => {
    expect(shortName('Martin Di Nenno')).toBe('Nenno')
    expect(shortName('Navarro')).toBe('Navarro')
    expect(shortName(null)).toBe('—')
  })
})

describe('mapLiveRowToMatch', () => {
  const nowMs = 1_000_000_000_000
  const base = {
    match_id: 'm1',
    pair1_prob: 0.82,
    pair2_prob: 0.18,
    pair1_decimal_odds: 1.22,
    pair2_decimal_odds: 5.54,
    anchor_source: 'model-prediction' as const,
    coverage: 'live-pbp' as const,
    computed_at: new Date(nowMs - 30_000).toISOString(),
    matches: {
      status: 'live',
      court: 'Campo 5',
      round_canonical: 'QF',
      category: 'men',
      tournament: { name: 'Italy Major', level: 'major' },
      p1a: { id: 'a', name: 'Martin Di Nenno' },
      p1b: { id: 'b', name: 'Francisco Navarro' },
      p2a: { id: 'c', name: 'Alonso Rodriguez' },
      p2b: { id: 'd', name: 'Juan De Pascual' },
    },
  }
  it('maps probs, names, confidence, status', () => {
    const m = mapLiveRowToMatch(base, {
      sets: [{ pair1_games: 6, pair2_games: 4, is_current: false }, { pair1_games: 3, pair2_games: 2, is_current: true }],
      gameScore: '40-30',
      servingPlayerId: 'a',
      history: [{ prob: 0.7, atMs: nowMs - 16 * 60_000 }, { prob: 0.82, atMs: nowMs - 30_000 }],
      currentSetStartedAt: null,
      prematchPair1Prob: 0.6,
    }, nowMs)
    expect(m.winProb1).toBeCloseTo(0.82)
    expect(m.pair1.name).toBe('M. Di Nenno / F. Navarro')
    expect(m.confidence).toBe('full')
    expect(m.status).toBe('live')
    expect(m.pair1.serving).toBe(true)
    expect(m.gamePoints).toEqual({ a: '40', b: '30' })
    expect(m.setScores).toHaveLength(2)
    expect(m.setScores[1].current).toBe(true)
    expect(m.movement15m).toBeCloseTo(0.12)
    expect(m.lastUpdatedSeconds).toBe(30)
    expect(m.prematch).toEqual({ pair1Prob: 0.6, correct: null })  // live → correct null
  })
})

describe('displayName', () => {
  it('formats as "Initial. FirstSurname"', () => {
    expect(displayName('Alejandro Galan Romo')).toBe('A. Galan')
    expect(displayName('Alonso Rodriguez Martinez')).toBe('A. Rodriguez')
    expect(displayName('Francisco Navarro')).toBe('F. Navarro')
  })
  it('keeps surname particles', () => {
    expect(displayName('Martin Di Nenno')).toBe('M. Di Nenno')
    expect(displayName('Maria De La Fuente')).toBe('M. De La Fuente')
  })
  it('passes through single token; handles null/empty', () => {
    expect(displayName('Navarro')).toBe('Navarro')
    expect(displayName(null)).toBe('—')
    expect(displayName('')).toBe('—')
  })
})

describe('mapFinishedRowToMatch', () => {
  const row = {
    id: 'f1', status: 'finished', winner_pair: 2, court: 'Campo 6', round_canonical: 'R16', category: 'men', scheduled_at: '2026-06-04T10:00:00Z',
    tournament: { name: 'Italy Major', level: 'major' },
    p1a: { id: 'a', name: 'Martin Di Nenno' }, p1b: { id: 'b', name: 'Francisco Navarro' },
    p2a: { id: 'c', name: 'Alejandro Galan Romo' }, p2b: { id: 'd', name: 'Juan Lebron' },
  }
  it('maps finished status, winner, scores, names', () => {
    const m = mapFinishedRowToMatch(row, { sets: [{ pair1_games: 4, pair2_games: 6 }, { pair1_games: 3, pair2_games: 6 }], closing: { pair1_prob: 0.18, pair1_decimal_odds: 5.5, pair2_decimal_odds: 1.2, coverage: 'live-pbp' }, history: [0.5, 0.18], prematchPair1Prob: 0.34 })
    expect(m.status).toBe('finished')
    expect(m.winnerPair).toBe(2)
    expect(m.pair1.name).toBe('M. Di Nenno / F. Navarro')
    expect(m.pair2.name).toBe('A. Galan / J. Lebron')
    expect(m.setScores).toEqual([{ a: 4, b: 6, current: false }, { a: 3, b: 6, current: false }])
    expect(m.winProb1).toBeCloseTo(0.18)
    expect(m.winProbHistory).toEqual([0.5, 0.18])
    // pre-match favored pair2 (0.34 < 0.5) and pair2 won → correct
    expect(m.prematch).toEqual({ pair1Prob: 0.34, correct: true })
  })
  it('defaults prob to 0.5 and winnerPair null when no closing/winner', () => {
    const m = mapFinishedRowToMatch({ ...row, winner_pair: null }, { sets: [], closing: null, history: [], prematchPair1Prob: null })
    expect(m.winProb1).toBeCloseTo(0.5)
    expect(m.winnerPair).toBeNull()
    expect(m.confidence).toBe('med')
    expect(m.prematch).toBeNull()  // no model_predictions row
  })
})

describe('predictionCorrect', () => {
  it('true when favored pair won', () => {
    expect(predictionCorrect(0.72, 1)).toBe(true)
    expect(predictionCorrect(0.30, 2)).toBe(true)   // favored pair2
  })
  it('false when favored pair lost', () => {
    expect(predictionCorrect(0.72, 2)).toBe(false)
    expect(predictionCorrect(0.30, 1)).toBe(false)
  })
  it('null when unknown', () => {
    expect(predictionCorrect(null, 1)).toBeNull()
    expect(predictionCorrect(0.7, null)).toBeNull()
    expect(predictionCorrect(0.5, 1)).toBeNull()    // tie, no favorite
  })
})

describe('isUpcomingStatus', () => {
  it('true for scheduled / null / unknown pre-start', () => {
    expect(isUpcomingStatus('scheduled')).toBe(true)
    expect(isUpcomingStatus(null)).toBe(true)
    expect(isUpcomingStatus('')).toBe(true)
  })
  it('false for live and terminal statuses', () => {
    for (const s of ['live','on_court','break','ended','finished','retired','walkover']) {
      expect(isUpcomingStatus(s)).toBe(false)
    }
  })
})
