import { describe, it, expect } from 'vitest'
import { flourishWinProbCsv } from '../win-prob-csv'
import type { Match, Pair } from '../types'

const pair = (name: string, extra: Partial<Pair> = {}): Pair => ({
  name,
  player1Name: name.split(' / ')[0] ?? name,
  player2Name: name.split(' / ')[1] ?? name,
  gender: 'men',
  serving: false,
  ...extra,
})

function match(over: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    pair1: pair('C. Orsi / P. Llaguno'),
    pair2: pair('A. Sanchez / A. Ustero'),
    tournament: 'Comunidad de Madrid P1',
    court: 'Court 2',
    round: 'R16',
    tier: 'p1',
    status: 'finished',
    scheduledAt: null,
    setScores: [],
    gamePoints: null,
    winProb1: 0.19,
    fairOdds1: 5.28,
    fairOdds2: 1.23,
    movement15m: 0,
    confidence: 'full',
    anchorSource: 'model-prediction',
    lastUpdatedSeconds: 0,
    winProbSeries: [],
    currentSetStartedAt: null,
    winnerPair: 2,
    prematch: { pair1Prob: 0.18, correct: true },
    ...over,
  }
}

describe('flourishWinProbCsv', () => {
  it('emits Flourish-wide rows: Name then one percent column per tick', () => {
    const csv = flourishWinProbCsv(
      match({
        winProbSeries: [
          { atMs: Date.parse('2026-09-03T10:41:00Z'), pair1Prob: 0.19 },
          { atMs: Date.parse('2026-09-03T10:42:00Z'), pair1Prob: 0.22 },
        ],
      }),
    )
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe('Name,2026-09-03 10:41:00,2026-09-03 10:42:00')
    expect(lines[1]).toBe('C. Orsi / P. Llaguno,19.0,22.0')
    expect(lines[2]).toBe('A. Sanchez / A. Ustero,81.0,78.0')
  })

  it('drops unchanged consecutive ticks so the race only moves when odds move', () => {
    const csv = flourishWinProbCsv(
      match({
        winProbSeries: [
          { atMs: 1_000, pair1Prob: 0.5 },
          { atMs: 2_000, pair1Prob: 0.5 },
          { atMs: 3_000, pair1Prob: 0.5 },
          { atMs: 4_000, pair1Prob: 0.6 },
        ],
        prematch: null,
      }),
    )
    const header = csv.split('\n')[0]
    expect(header.split(',').length).toBe(3) // Name + first plateau + change
  })

  it('quotes names that contain commas', () => {
    const csv = flourishWinProbCsv(
      match({
        pair1: pair('Smith, Jr / Jones'),
        winProbSeries: [{ atMs: Date.parse('2026-09-03T10:00:00Z'), pair1Prob: 0.4 }],
        prematch: null,
      }),
    )
    expect(csv.split('\n')[1]).toMatch(/^"Smith, Jr \/ Jones",40\.0/)
  })
})
