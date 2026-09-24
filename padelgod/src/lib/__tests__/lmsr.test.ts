import { describe, it, expect } from 'vitest'
import { bFromMaxLoss, maxLoss, cost, priceYes, seedShares, quoteBuy, quoteSell } from '../lmsr.js'

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

describe('quoteBuy', () => {
  const b = 7213

  it('spends exactly the guacas offered', () => {
    const { qYes, qNo } = seedShares(0.38, b)
    const q = quoteBuy(qYes, qNo, b, 'yes', 250)
    expect(q.cost).toBeGreaterThanOrEqual(250)
    expect(q.cost).toBeLessThanOrEqual(251)
  })

  it('buying YES moves the YES price up', () => {
    const { qYes, qNo } = seedShares(0.38, b)
    const before = priceYes(qYes, qNo, b)
    const q = quoteBuy(qYes, qNo, b, 'yes', 2000)
    expect(priceYes(q.qYesAfter, q.qNoAfter, b)).toBeGreaterThan(before)
  })

  it('buying NO moves the YES price down', () => {
    const { qYes, qNo } = seedShares(0.38, b)
    const before = priceYes(qYes, qNo, b)
    const q = quoteBuy(qYes, qNo, b, 'no', 2000)
    expect(priceYes(q.qYesAfter, q.qNoAfter, b)).toBeLessThan(before)
  })

  it('a cheap side buys more shares than an expensive one', () => {
    const { qYes, qNo } = seedShares(0.20, b)
    const cheap = quoteBuy(qYes, qNo, b, 'yes', 1000)
    const dear  = quoteBuy(qYes, qNo, b, 'no', 1000)
    expect(cheap.shares).toBeGreaterThan(dear.shares)
  })

  it('average price paid is worse than the pre-trade price (slippage)', () => {
    const { qYes, qNo } = seedShares(0.50, b)
    const q = quoteBuy(qYes, qNo, b, 'yes', 2000)
    expect(q.avgPrice).toBeGreaterThan(0.50)
  })

  it('rejects a non-positive stake', () => {
    const { qYes, qNo } = seedShares(0.5, b)
    expect(() => quoteBuy(qYes, qNo, b, 'yes', 0)).toThrow()
  })
})

describe('quoteSell', () => {
  const b = 7213

  it('selling back what you just bought returns roughly what you paid', () => {
    const { qYes, qNo } = seedShares(0.45, b)
    const buy = quoteBuy(qYes, qNo, b, 'yes', 1000)
    const sell = quoteSell(buy.qYesAfter, buy.qNoAfter, b, 'yes', buy.shares)
    expect(sell.refund).toBeGreaterThan(996)
    expect(sell.refund).toBeLessThanOrEqual(1000)
  })

  it('rounds the refund down, never up — selling cannot mint guacas', () => {
    const { qYes, qNo } = seedShares(0.45, b)
    const buy = quoteBuy(qYes, qNo, b, 'yes', 1000)
    const sell = quoteSell(buy.qYesAfter, buy.qNoAfter, b, 'yes', buy.shares)
    expect(Number.isInteger(sell.refund)).toBe(true)
    expect(sell.refund).toBeLessThanOrEqual(buy.cost)
  })

  it('rejects selling more shares than exist on that side', () => {
    const { qYes, qNo } = seedShares(0.5, b)
    expect(() => quoteSell(qYes, qNo, b, 'yes', 1e12)).toThrow()
  })
})
