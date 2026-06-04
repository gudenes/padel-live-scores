// apps/ops/src/app/(app)/today/_lib/scoreboard-data.test.ts
import { describe, it, expect } from 'vitest'
import { shortName, mapLiveRowToMatch } from './scoreboard-data'

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
    }, nowMs)
    expect(m.winProb1).toBeCloseTo(0.82)
    expect(m.pair1.name).toBe('Nenno / Navarro')
    expect(m.confidence).toBe('full')
    expect(m.status).toBe('live')
    expect(m.pair1.serving).toBe(true)
    expect(m.gamePoints).toEqual({ a: '40', b: '30' })
    expect(m.setScores).toHaveLength(2)
    expect(m.setScores[1].current).toBe(true)
    expect(m.movement15m).toBeCloseTo(0.12)
    expect(m.lastUpdatedSeconds).toBe(30)
  })
})
