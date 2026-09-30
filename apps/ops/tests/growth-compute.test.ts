// apps/ops/tests/growth-compute.test.ts
import { describe, it, expect } from 'vitest'
import { dayRange, fillDaily, splitWindows, pct } from '../src/lib/growth/growth-compute'

describe('dayRange', () => {
  it('returns oldest → newest ending at endDay', () => {
    expect(dayRange('2026-09-30', 3)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30'])
  })
  it('crosses month boundaries', () => {
    expect(dayRange('2026-10-01', 2)).toEqual(['2026-09-30', '2026-10-01'])
  })
})

describe('fillDaily', () => {
  it('zero-fills missing days', () => {
    const out = fillDaily([{ day: '2026-09-29', n: 4 }], '2026-09-30', 3)
    expect(out).toEqual([
      { day: '2026-09-28', n: 0 },
      { day: '2026-09-29', n: 4 },
      { day: '2026-09-30', n: 0 },
    ])
  })
  it('ignores rows outside the window', () => {
    const out = fillDaily([{ day: '2026-01-01', n: 9 }], '2026-09-30', 2)
    expect(out.every(p => p.n === 0)).toBe(true)
  })
})

describe('splitWindows', () => {
  it('sums current vs prior windows', () => {
    const pts = [1, 1, 2, 2, 3, 3].map((n, i) => ({ day: `d${i}`, n }))
    expect(splitWindows(pts, 2)).toEqual({ current: 6, prior: 4 })
  })
  it('prior is 0 when history is shorter than two windows', () => {
    const pts = [5, 5].map((n, i) => ({ day: `d${i}`, n }))
    expect(splitWindows(pts, 2)).toEqual({ current: 10, prior: 0 })
  })
})

describe('pct', () => {
  it('rounds to integer percent', () => expect(pct(1, 3)).toBe(33))
  it('is 0 for empty denominator', () => expect(pct(5, 0)).toBe(0))
})
