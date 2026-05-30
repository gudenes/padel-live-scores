import { describe, it, expect } from 'vitest'
import { pWinGame, pWinTiebreak } from '../scoring'
import { pWinMatchFav, anchorPerPoint } from '../scoring'
import type { ScoreState } from '../types'

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

const zero: ScoreState = {
  setsWon: [0, 0], gamesInSet: [0, 0], currentGamePoints: [0, 0],
  inTiebreak: false, tiebreakPoints: [0, 0], goldenPoint: false,
}

describe('pWinMatchFav', () => {
  it('is 0.5 at the start when p=0.5', () => {
    expect(pWinMatchFav(0.5, zero)).toBeCloseTo(0.5, 4)
  })
  it('best-of-3: 1 when favorite already has two sets, 0 when opponent does', () => {
    expect(pWinMatchFav(0.55, { ...zero, setsWon: [2, 0] })).toBe(1)
    expect(pWinMatchFav(0.55, { ...zero, setsWon: [0, 2] })).toBe(0)
  })
  it('monotonic: more games in the current set never lowers the prob', () => {
    const a = pWinMatchFav(0.55, { ...zero, gamesInSet: [5, 0] })
    const b = pWinMatchFav(0.55, { ...zero, gamesInSet: [0, 5] })
    expect(a).toBeGreaterThan(b)
  })
  it('a favorite at 40-0, 5-0, 1 set up is nearly certain', () => {
    const s: ScoreState = { ...zero, setsWon: [1, 0], gamesInSet: [5, 0], currentGamePoints: [3, 0] }
    expect(pWinMatchFav(0.55, s)).toBeGreaterThan(0.99)
  })
})

describe('anchorPerPoint', () => {
  it('finds p such that the 0-0 match prob equals the target (within 1e-4)', () => {
    for (const target of [0.55, 0.65, 0.8]) {
      const p = anchorPerPoint(target, false)
      expect(pWinMatchFav(p, zero)).toBeCloseTo(target, 4)
      expect(p).toBeGreaterThan(0.5)
      expect(p).toBeLessThan(1)
    }
  })
})
