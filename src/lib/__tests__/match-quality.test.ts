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
