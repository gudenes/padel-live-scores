import { describe, it, expect } from 'vitest'
import { bFromMaxLoss, maxLoss, cost, priceYes, seedShares } from '../lmsr.js'

describe('bFromMaxLoss / maxLoss', () => {
  it('round-trips: b derived from a ceiling reproduces that ceiling', () => {
    const b = bFromMaxLoss(5000)
    expect(b).toBeCloseTo(5000 / Math.LN2, 6)
    expect(maxLoss(b)).toBeCloseTo(5000, 6)
  })
  it('rejects a non-positive ceiling', () => {
    expect(() => bFromMaxLoss(0)).toThrow()
  })
})

describe('priceYes', () => {
  it('is 0.5 at equal share counts', () => {
    expect(priceYes(0, 0, 7213)).toBeCloseTo(0.5, 9)
  })
  it('rises as YES shares are bought', () => {
    expect(priceYes(1000, 0, 7213)).toBeGreaterThan(0.5)
  })
  it('stays in (0,1) at extreme imbalance', () => {
    const p = priceYes(1e6, 0, 7213)
    expect(p).toBeLessThanOrEqual(1)
    expect(p).toBeGreaterThan(0.5)
    expect(Number.isFinite(p)).toBe(true)
  })
})

describe('cost', () => {
  it('is b·ln(2) at the origin', () => {
    expect(cost(0, 0, 7213)).toBeCloseTo(7213 * Math.LN2, 6)
  })
  it('does not overflow at large share counts', () => {
    expect(Number.isFinite(cost(1e7, 0, 7213))).toBe(true)
  })
})

describe('seedShares', () => {
  it('produces exactly the requested opening price', () => {
    const b = 7213
    for (const p of [0.05, 0.34, 0.5, 0.68, 0.95]) {
      const { qYes, qNo } = seedShares(p, b)
      expect(priceYes(qYes, qNo, b)).toBeCloseTo(p, 9)
    }
  })
  it('costs nothing to open — C(seed) is zero', () => {
    const b = 7213
    const { qYes, qNo } = seedShares(0.34, b)
    expect(cost(qYes, qNo, b)).toBeCloseTo(0, 6)
  })
  it('rejects probabilities outside (0,1)', () => {
    expect(() => seedShares(0, 7213)).toThrow()
    expect(() => seedShares(1, 7213)).toThrow()
  })
})
