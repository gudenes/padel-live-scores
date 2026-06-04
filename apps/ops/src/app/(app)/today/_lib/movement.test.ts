// apps/ops/src/app/(app)/today/_lib/movement.test.ts
import { describe, it, expect } from 'vitest'
import { movement15m, capHistory, coverageToConfidence, biggestSwing } from './movement'

describe('capHistory', () => {
  it('keeps the last N values, oldest→newest', () => {
    const xs = Array.from({ length: 40 }, (_, i) => i / 100)
    expect(capHistory(xs, 30)).toHaveLength(30)
    expect(capHistory(xs, 30)[0]).toBeCloseTo(0.1)      // 40-30 = index 10
    expect(capHistory(xs, 30)[29]).toBeCloseTo(0.39)
  })
  it('returns all when shorter than cap', () => {
    expect(capHistory([0.5, 0.6], 30)).toEqual([0.5, 0.6])
  })
})

describe('movement15m', () => {
  // series of {prob, atMs}; "now" passed explicitly for determinism
  const now = 1_000_000_000_000
  it('is the signed delta vs the value closest to 15m ago', () => {
    const series = [
      { prob: 0.40, atMs: now - 16 * 60_000 },
      { prob: 0.55, atMs: now - 1 * 60_000 },
    ]
    expect(movement15m(series, now)).toBeCloseTo(0.15)
  })
  it('is 0 when fewer than 2 points', () => {
    expect(movement15m([{ prob: 0.5, atMs: now }], now)).toBe(0)
    expect(movement15m([], now)).toBe(0)
  })
  it('uses the oldest point if none is older than 15m', () => {
    const series = [
      { prob: 0.50, atMs: now - 5 * 60_000 },
      { prob: 0.58, atMs: now - 1 * 60_000 },
    ]
    expect(movement15m(series, now)).toBeCloseTo(0.08)
  })
})

describe('coverageToConfidence', () => {
  it('maps live-pbp→full, live-coarse→low, else med', () => {
    expect(coverageToConfidence('live-pbp')).toBe('full')
    expect(coverageToConfidence('live-coarse')).toBe('low')
    expect(coverageToConfidence(null)).toBe('med')
  })
})

describe('biggestSwing', () => {
  it('picks the max absolute movement and returns signed pct + label', () => {
    const res = biggestSwing([
      { movement15m: 0.10, label: 'A' },
      { movement15m: -0.34, label: 'B' },
      { movement15m: 0.05, label: 'C' },
    ])
    expect(res.pct).toBeCloseTo(-34)
    expect(res.label).toBe('B')
  })
  it('returns zeroed result for empty input', () => {
    expect(biggestSwing([])).toEqual({ pct: 0, label: '—' })
  })
})
