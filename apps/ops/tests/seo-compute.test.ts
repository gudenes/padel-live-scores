// apps/ops/tests/seo-compute.test.ts
import { describe, it, expect } from 'vitest'
import { sumWindow, windowDelta, weightedAvgPosition } from '../src/lib/seo/seo-compute'
import type { SnapshotRow } from '../src/lib/seo/seo-compute'

const rows = (...vals: Array<[string, number, number, number | null]>): SnapshotRow[] =>
  vals.map(([day, clicks, impressions, avg_position]) => ({
    day, locale: 'total', clicks, impressions, avg_position, ctr: null,
  }))

describe('sumWindow', () => {
  it('sums clicks and impressions across rows', () => {
    const r = rows(
      ['2026-05-20', 100, 1000, 10],
      ['2026-05-21', 150, 1500, 9],
    )
    expect(sumWindow(r)).toEqual({ clicks: 250, impressions: 2500 })
  })

  it('returns zeros for empty', () => {
    expect(sumWindow([])).toEqual({ clicks: 0, impressions: 0 })
  })
})

describe('windowDelta', () => {
  it('computes positive delta', () => {
    expect(windowDelta(120, 100)).toEqual({ deltaPct: 20, direction: 'up' })
  })

  it('computes negative delta', () => {
    expect(windowDelta(80, 100)).toEqual({ deltaPct: -20, direction: 'down' })
  })

  it('handles zero prior (treat as +∞ → cap at 999)', () => {
    expect(windowDelta(50, 0)).toEqual({ deltaPct: 999, direction: 'up' })
  })

  it('handles zero both ways', () => {
    expect(windowDelta(0, 0)).toEqual({ deltaPct: 0, direction: 'flat' })
  })

  it('marks ±2% as flat', () => {
    expect(windowDelta(101, 100)).toEqual({ deltaPct: 1, direction: 'flat' })
    expect(windowDelta(99, 100)).toEqual({ deltaPct: -1, direction: 'flat' })
  })
})

describe('weightedAvgPosition', () => {
  it('weights by impressions', () => {
    // 10 impr at pos 5 + 90 impr at pos 15 = avg ((10*5)+(90*15))/100 = 14
    const r = [
      { day: 'd1', locale: 'en', clicks: 1, impressions: 10, avg_position: 5,  ctr: null },
      { day: 'd2', locale: 'en', clicks: 1, impressions: 90, avg_position: 15, ctr: null },
    ]
    expect(weightedAvgPosition(r)).toBe(14)
  })

  it('returns null when no impressions', () => {
    expect(weightedAvgPosition([])).toBeNull()
  })

  it('skips rows with null position', () => {
    const r = [
      { day: 'd1', locale: 'en', clicks: 1, impressions: 100, avg_position: null, ctr: null },
      { day: 'd2', locale: 'en', clicks: 1, impressions: 50,  avg_position: 10,   ctr: null },
    ]
    expect(weightedAvgPosition(r)).toBe(10)
  })
})
