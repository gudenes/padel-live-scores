import { describe, it, expect } from 'vitest'
import { pWinGame, pWinTiebreak } from '../scoring'

describe('pWinGame (ad scoring)', () => {
  it('is 0.5 at love-all when p=0.5', () => {
    expect(pWinGame(0.5, 0, 0, false)).toBeCloseTo(0.5, 6)
  })
  it('returns 1 when already won, 0 when already lost', () => {
    expect(pWinGame(0.6, 4, 2, false)).toBe(1)
    expect(pWinGame(0.6, 2, 4, false)).toBe(0)
  })
  it('deuce closed form: P(win from 40-40) = p^2/(p^2+q^2)', () => {
    const p = 0.6, q = 0.4
    expect(pWinGame(p, 3, 3, false)).toBeCloseTo((p * p) / (p * p + q * q), 9)
  })
  it('rises monotonically with p at love-all', () => {
    expect(pWinGame(0.55, 0, 0, false)).toBeGreaterThan(pWinGame(0.45, 0, 0, false))
  })
})

describe('pWinGame (golden point / no-ad)', () => {
  it('40-40 is decided by a single point = p', () => {
    expect(pWinGame(0.6, 3, 3, true)).toBeCloseTo(0.6, 9)
  })
  it('first to 4 wins regardless of margin', () => {
    expect(pWinGame(0.6, 4, 3, true)).toBe(1)
    expect(pWinGame(0.6, 3, 4, true)).toBe(0)
  })
})

describe('pWinTiebreak', () => {
  it('0.5 at 0-0 when p=0.5', () => {
    expect(pWinTiebreak(0.5, 0, 0)).toBeCloseTo(0.5, 6)
  })
  it('deuce at 6-6 uses the closed form', () => {
    const p = 0.6, q = 0.4
    expect(pWinTiebreak(p, 6, 6)).toBeCloseTo((p * p) / (p * p + q * q), 9)
  })
  it('terminal: 7-5 wins, 5-7 loses', () => {
    expect(pWinTiebreak(0.6, 7, 5)).toBe(1)
    expect(pWinTiebreak(0.6, 5, 7)).toBe(0)
  })
})
