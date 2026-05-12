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

import { roundKey, roundWeight, alpha } from '../match-quality'

describe('roundKey (normalization)', () => {
  it('handles "Round of 32" and "R32" and "1/16" as r32', () => {
    expect(roundKey('Round of 32')).toBe('r32')
    expect(roundKey('R32')).toBe('r32')
    expect(roundKey('r32')).toBe('r32')
    expect(roundKey('1/16')).toBe('r32')
  })
  it('handles R16/R64/R128', () => {
    expect(roundKey('Round of 16')).toBe('r16')
    expect(roundKey('Round of 64')).toBe('r64')
    expect(roundKey('Round of 128')).toBe('r128')
  })
  it('handles Final, SF, QF in various forms', () => {
    expect(roundKey('Final')).toBe('final')
    expect(roundKey('FINAL')).toBe('final')
    expect(roundKey('Semifinal')).toBe('sf')
    expect(roundKey('1/2')).toBe('sf')
    expect(roundKey('SF')).toBe('sf')
    expect(roundKey('Quarterfinal')).toBe('qf')
    expect(roundKey('1/4')).toBe('qf')
    expect(roundKey('QF')).toBe('qf')
  })
  it('handles qualifying rounds', () => {
    expect(roundKey('Q1')).toBe('q')
    expect(roundKey('Q2')).toBe('q')
    expect(roundKey('Qualifying')).toBe('q')
  })
  it('unknown or null → "unknown"', () => {
    expect(roundKey(null)).toBe('unknown')
    expect(roundKey('')).toBe('unknown')
    expect(roundKey('Group Stage')).toBe('unknown')
  })
  it('does NOT match SF as final', () => {
    // "Semifinal" contains "final" — must NOT classify as Final.
    expect(roundKey('Semifinal')).toBe('sf')
  })
})

describe('roundWeight', () => {
  it('Final is the only round above 1.0', () => {
    expect(roundWeight('Final')).toBe(1.15)
    expect(roundWeight('Semifinal')).toBeLessThan(1.0)
  })
  it('R32 > R64 > R128 > Q', () => {
    expect(roundWeight('R32')).toBeGreaterThan(roundWeight('R64'))
    expect(roundWeight('R64')).toBeGreaterThan(roundWeight('R128'))
    expect(roundWeight('R128')).toBeGreaterThan(roundWeight('Q1'))
  })
  it('unknown falls back to 0.55', () => {
    expect(roundWeight('Group Stage')).toBe(0.55)
  })
})

describe('alpha (star-bonus weight by round)', () => {
  it('Final = 0.0 (parity-only decides)', () => {
    expect(alpha('Final')).toBe(0.00)
  })
  it('Qualifying = 0.35 (star matters most)', () => {
    expect(alpha('Q1')).toBe(0.35)
  })
  it('decreases monotonically Q → Final', () => {
    expect(alpha('Q1')).toBeGreaterThan(alpha('R128'))
    expect(alpha('R128')).toBeGreaterThan(alpha('R64'))
    expect(alpha('R64')).toBeGreaterThan(alpha('R32'))
    expect(alpha('R32')).toBeGreaterThan(alpha('R16'))
    expect(alpha('R16')).toBeGreaterThan(alpha('QF'))
    expect(alpha('QF')).toBeGreaterThan(alpha('SF'))
    expect(alpha('SF')).toBeGreaterThan(alpha('Final'))
  })
})
