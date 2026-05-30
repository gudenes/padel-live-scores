// apps/ops/src/app/(app)/live-odds/_lib/__tests__/odds-math.test.ts
import { describe, it, expect } from 'vitest'
import { fmtOdds, seedHistory, chartPoints, computeKpis, jitterWinProb } from '../odds-math'
import type { Match } from '../types'

describe('odds-math', () => {
  it('fmtOdds returns 100/pct clamped to 2dp', () => {
    expect(fmtOdds(82)).toBe('1.22')
    expect(fmtOdds(18)).toBe('5.56')
    expect(fmtOdds(0)).toBe('100.00')   // clamped to 1
    expect(fmtOdds(100)).toBe('1.01')   // clamped to 99
  })

  it('seedHistory ends exactly at target and stays in 5..95', () => {
    const h = seedHistory(82)
    expect(h[h.length - 1]).toBe(82)
    expect(Math.min(...h)).toBeGreaterThanOrEqual(5)
    expect(Math.max(...h)).toBeLessThanOrEqual(95)
    expect(h.length).toBe(26)
  })

  it('chartPoints maps history to CW x CH coordinates', () => {
    const pts = chartPoints([0, 50, 100], 348, 120)
    expect(pts[0]).toEqual([0, 120])      // 0% → bottom
    expect(pts[1]).toEqual([174, 60])     // 50% → middle
    expect(pts[2]).toEqual([348, 0])      // 100% → top
  })

  it('jitterWinProb clamps to 4..96 and recomputes loser + odds', () => {
    const r = jitterWinProb(95, () => 1) // max positive jitter
    expect(r.pa).toBeLessThanOrEqual(96)
    expect(r.pb).toBe(100 - r.pa)
    expect(r.oa).toBe(fmtOdds(r.pa))
    expect(r.ob).toBe(fmtOdds(r.pb))
  })

  it('computeKpis aggregates the live set', () => {
    const matches = [
      { status: 'Live', confidence: 'full' },
      { status: 'Live', confidence: 'low' },
      { status: 'Scheduled', confidence: 'med' },
    ] as Match[]
    const k = computeKpis(matches)
    expect(k.liveMatches).toBe(2)
    expect(k.lowCoverage).toBe(1)
  })
})
