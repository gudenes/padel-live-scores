import { describe, it, expect } from 'vitest'
import { attachScoreToSeries, flourishCaptionsCsv, isBreakPoint, pressureOnsets, scoreTimeline, setBoundaryTimes } from '../score-timeline'

const pt = (
  t: string,
  score_after: string,
  set_id: string,
  game_id: string,
  winner_pair: 1 | 2,
  extra: { server_player_id?: string | null } = {},
) => ({ created_at: t, score_after, set_id, game_id, winner_pair, ...extra })

describe('scoreTimeline', () => {
  it('starts at 0-0 with the current game score', () => {
    const out = scoreTimeline([
      pt('2026-09-03T10:00:00Z', '15-0', 's1', 'g1', 1),
      pt('2026-09-03T10:00:20Z', '30-0', 's1', 'g1', 1),
    ])
    expect(out.map((r) => r.score)).toEqual(['0-0 15-0', '0-0 30-0'])
  })

  it('increments games when the game_id changes', () => {
    const out = scoreTimeline([
      pt('t1', '40-15', 's1', 'g1', 1),
      pt('t2', '15-0', 's1', 'g2', 2),
    ])
    expect(out[1].score).toBe('1-0 15-0')
  })

  it('archives a completed set when set_id changes', () => {
    const out = scoreTimeline([
      pt('t1', '40-0', 's1', 'g1', 1),
      pt('t2', '40-0', 's1', 'g2', 1),
      pt('t3', '15-0', 's2', 'g1', 1),
    ])
    expect(out[2].score).toBe('2-0 0-0 15-0')
  })
})

describe('attachScoreToSeries', () => {
  it('uses the latest point at or before each tick', () => {
    const scores = scoreTimeline([
      pt('2026-09-03T10:00:00Z', '15-0', 's1', 'g1', 1),
      pt('2026-09-03T10:01:00Z', '30-0', 's1', 'g1', 1),
    ])
    const series = [
      { atMs: Date.parse('2026-09-03T10:00:30Z'), pair1Prob: 0.6 },
      { atMs: Date.parse('2026-09-03T10:01:10Z'), pair1Prob: 0.7 },
    ]
    const attached = attachScoreToSeries(series, scores)
    expect(attached.map((t) => t.score)).toEqual(['0-0 15-0', '0-0 30-0'])
  })
})

describe('isBreakPoint', () => {
  it('is BP when the receiver is one point from the game', () => {
    expect(isBreakPoint('30-40', 1)).toBe(true)
    expect(isBreakPoint('40-AD', 1)).toBe(true)
    expect(isBreakPoint('40-30', 2)).toBe(true)
    expect(isBreakPoint('AD-40', 2)).toBe(true)
  })
  it('is not BP when the server is the one a point from the game', () => {
    expect(isBreakPoint('40-30', 1)).toBe(false)
    expect(isBreakPoint('AD-40', 1)).toBe(false)
    expect(isBreakPoint('30-40', 2)).toBe(false)
  })
  it('treats 40-40 golden point as BP for either server', () => {
    expect(isBreakPoint('40-40', 1)).toBe(true)
    expect(isBreakPoint('40-40', 2)).toBe(true)
  })
  it('ignores tiebreak numeric scores', () => {
    expect(isBreakPoint('6-5', 1)).toBe(false)
    expect(isBreakPoint('5-6', 2)).toBe(false)
  })
})

describe('scoreTimeline serve + pressure flags', () => {
  const pair1 = new Set(['p1a'])
  const pair2 = new Set(['p2a'])
  const ids = { pair1, pair2 }

  it('maps server_player_id onto the serving pair', () => {
    const out = scoreTimeline([
      pt('t1', '30-40', 's1', 'g1', 2, { server_player_id: 'p1a' }),
    ], ids)
    expect(out[0].serverPair).toBe(1)
    expect(out[0].isBreakPoint).toBe(true)
  })

  it('marks set point when the receiver would take the set 6-4', () => {
    const out = scoreTimeline([
      pt('g1', '40-0', 's1', 'g1', 1, { server_player_id: 'p1a' }),
      pt('g2', '40-0', 's1', 'g2', 1, { server_player_id: 'p2a' }),
      pt('g3', '40-0', 's1', 'g3', 1, { server_player_id: 'p1a' }),
      pt('g4', '40-0', 's1', 'g4', 1, { server_player_id: 'p2a' }),
      pt('g5', '40-0', 's1', 'g5', 1, { server_player_id: 'p1a' }),
      pt('bp', '40-30', 's1', 'g6', 1, { server_player_id: 'p2a' }),
    ], ids)
    const last = out[out.length - 1]
    expect(last.score).toBe('5-0 40-30')
    expect(last.serverPair).toBe(2)
    expect(last.isBreakPoint).toBe(true)
    expect(last.isSetPoint).toBe(true)
  })

  it('records setsCompleted so the chart can draw a bar at each set end', () => {
    const out = scoreTimeline([
      pt('2026-09-03T17:00:00Z', '40-0', 's1', 'g1', 1, { server_player_id: 'p1a' }),
      pt('2026-09-03T17:01:00Z', '40-0', 's1', 'g2', 1, { server_player_id: 'p2a' }),
      pt('2026-09-03T17:20:00Z', '15-0', 's2', 'g1', 1, { server_player_id: 'p1a' }),
    ], ids)
    expect(out[0].setsCompleted).toBe(0)
    expect(out[1].setsCompleted).toBe(0)
    expect(out[2].setsCompleted).toBe(1)
    const ticks = attachScoreToSeries(
      [
        { atMs: Date.parse('2026-09-03T17:00:30Z'), pair1Prob: 0.6 },
        { atMs: Date.parse('2026-09-03T17:01:30Z'), pair1Prob: 0.7 },
        { atMs: Date.parse('2026-09-03T17:20:10Z'), pair1Prob: 0.8 },
      ],
      out,
    )
    expect(setBoundaryTimes(ticks)).toEqual([Date.parse('2026-09-03T17:01:30Z')])
  })
})

describe('pressureOnsets', () => {
  const tick = (flags: { isBreakPoint?: boolean; isSetPoint?: boolean; isMatchPoint?: boolean }) => flags

  it('keeps one SP marker for a run of set-point snapshots, not one per tick', () => {
    const out = pressureOnsets([
      tick({}),
      tick({ isSetPoint: true }),
      tick({ isSetPoint: true }),
      tick({ isSetPoint: true }),
      tick({}),
      tick({ isSetPoint: true }),
    ])
    expect(out.map((o) => o.sp)).toEqual([false, true, false, false, false, true])
  })

  it('does not also paint SP when the run is a match point', () => {
    const out = pressureOnsets([
      tick({ isSetPoint: true, isMatchPoint: true }),
      tick({ isSetPoint: true, isMatchPoint: true }),
    ])
    expect(out.map((o) => o.mp)).toEqual([true, false])
    expect(out.map((o) => o.sp)).toEqual([false, false])
  })

  it('paints BP only at the start of a break-point run', () => {
    const out = pressureOnsets([
      tick({ isBreakPoint: true }),
      tick({ isBreakPoint: true }),
      tick({}),
    ])
    expect(out.map((o) => o.bp)).toEqual([true, false, false])
  })
})

describe('flourishCaptionsCsv', () => {
  it('merges consecutive identical scores into from/to ranges', () => {
    const csv = flourishCaptionsCsv([
      { atMs: Date.parse('2026-09-03T10:00:00Z'), pair1Prob: 0.5, score: '0-0 15-0' },
      { atMs: Date.parse('2026-09-03T10:00:20Z'), pair1Prob: 0.52, score: '0-0 15-0' },
      { atMs: Date.parse('2026-09-03T10:00:40Z'), pair1Prob: 0.55, score: '0-0 30-0' },
    ])
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe('from,to,text')
    expect(lines[1]).toBe('2026-09-03 10:00:00,2026-09-03 10:00:20,0-0 15-0')
    expect(lines[2]).toBe('2026-09-03 10:00:40,2026-09-03 10:00:40,0-0 30-0')
  })
})
