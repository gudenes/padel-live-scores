import { describe, it, expect } from 'vitest'
import { parity, pWin } from '../match-quality'

describe('pWin (Elo-style)', () => {
  it('equal effective ranks → 0.5', () => {
    expect(pWin(50, 50)).toBeCloseTo(0.5, 5)
  })
  it('huge favorite (lower rank wins)', () => {
    // pair A rank 10 vs pair B rank 500 → A wins very likely
    expect(pWin(10, 500)).toBeGreaterThan(0.9)
  })
  it('monotonic in rank gap', () => {
    expect(pWin(50, 100)).toBeGreaterThan(pWin(50, 75))
  })
})

describe('parity', () => {
  it('equal pWin → 1.0 (tightest)', () => {
    expect(parity(0.5)).toBeCloseTo(1.0, 5)
  })
  it('blowout (pWin = 0.95) → 0.10', () => {
    expect(parity(0.95)).toBeCloseTo(0.10, 5)
  })
  it('total mismatch (pWin = 0) → 0.0', () => {
    expect(parity(0)).toBe(0)
  })
})

import { pairEffRank, starDamper, starPower } from '../match-quality'

describe('pairEffRank', () => {
  it('weights best 0.65, worst 0.35', () => {
    // best=10, worst=100 → 0.65*10 + 0.35*100 = 6.5 + 35 = 41.5
    expect(pairEffRank(10, 100)).toBeCloseTo(41.5, 5)
    expect(pairEffRank(100, 10)).toBeCloseTo(41.5, 5)  // order-insensitive
  })
  it('null rank uses 1500 fallback', () => {
    expect(pairEffRank(null, 50)).toBeCloseTo(0.65 * 50 + 0.35 * 1500, 5)
    expect(pairEffRank(null, null)).toBe(1500)
  })
  it('equal ranks → that rank', () => {
    expect(pairEffRank(40, 40)).toBe(40)
  })
})

describe('starPower (linear by avg rank)', () => {
  it('rank 0 → 1.0', () => {
    expect(starPower(0)).toBe(1.0)
  })
  it('rank 2000 → 0', () => {
    expect(starPower(2000)).toBe(0)
  })
  it('rank 1000 → 0.5', () => {
    expect(starPower(1000)).toBe(0.5)
  })
  it('clamps above 2000', () => {
    expect(starPower(3000)).toBe(0)
  })
})

describe('starDamper', () => {
  it('avg rank 0 → 1.0', () => {
    expect(starDamper(0)).toBe(1.0)
  })
  it('avg rank 2000 → 0.5', () => {
    expect(starDamper(2000)).toBe(0.5)
  })
  it('avg rank 1000 → 0.75', () => {
    expect(starDamper(1000)).toBe(0.75)
  })
})
