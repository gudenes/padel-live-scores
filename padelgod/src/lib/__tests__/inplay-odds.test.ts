import { describe, it, expect } from 'vitest'
import { pWinGame, pWinTiebreak, pWinMatchFav, anchorPerPoint, type ScoreState } from '../inplay-odds.js'

const zero: ScoreState = {
  setsWon: [0, 0], gamesInSet: [0, 0], currentGamePoints: [0, 0],
  inTiebreak: false, tiebreakPoints: [0, 0], goldenPoint: true,
}

describe('pWinGame', () => {
  it('0.5 at love-all when p=0.5 (ad scoring)', () => {
    expect(pWinGame(0.5, 0, 0, false)).toBeCloseTo(0.5, 6)
  })
  it('deuce closed form p^2/(p^2+q^2)', () => {
    const p = 0.6, q = 0.4
    expect(pWinGame(p, 3, 3, false)).toBeCloseTo((p * p) / (p * p + q * q), 9)
  })
  it('golden point: 40-40 decided by one point = p', () => {
    expect(pWinGame(0.6, 3, 3, true)).toBeCloseTo(0.6, 9)
  })
  it('terminals', () => {
    expect(pWinGame(0.6, 4, 2, false)).toBe(1)
    expect(pWinGame(0.6, 2, 4, false)).toBe(0)
  })
})

describe('pWinTiebreak', () => {
  it('0.5 at 0-0 when p=0.5', () => { expect(pWinTiebreak(0.5, 0, 0)).toBeCloseTo(0.5, 6) })
  it('7-5 wins / 5-7 loses', () => {
    expect(pWinTiebreak(0.6, 7, 5)).toBe(1); expect(pWinTiebreak(0.6, 5, 7)).toBe(0)
  })
})

describe('pWinMatchFav', () => {
  it('0.5 at start when p=0.5', () => { expect(pWinMatchFav(0.5, zero)).toBeCloseTo(0.5, 4) })
  it('already two sets up → 1', () => { expect(pWinMatchFav(0.55, { ...zero, setsWon: [2, 0] })).toBe(1) })
  it('monotonic: leading helps', () => {
    expect(pWinMatchFav(0.55, { ...zero, gamesInSet: [5, 0] }))
      .toBeGreaterThan(pWinMatchFav(0.55, { ...zero, gamesInSet: [0, 5] }))
  })
})

describe('anchorPerPoint', () => {
  it('0-0 match prob equals the target within 1e-4', () => {
    for (const t of [0.55, 0.7, 0.82]) {
      const p = anchorPerPoint(t, true)
      expect(pWinMatchFav(p, zero)).toBeCloseTo(t, 4)
    }
  })
})
