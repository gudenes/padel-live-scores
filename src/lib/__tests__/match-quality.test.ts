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

import { tierWeight, starStrength } from '../match-quality'

describe('tierWeight', () => {
  it('p1 = 1.00', () => expect(tierWeight('p1')).toBe(1.00))
  it('major = 0.95', () => expect(tierWeight('major')).toBe(0.95))
  it('p2, premier_mens, premier_womens = 0.85', () => {
    expect(tierWeight('p2')).toBe(0.85)
    expect(tierWeight('premier_mens')).toBe(0.85)
    expect(tierWeight('premier_womens')).toBe(0.85)
  })
  it('fip tiers descend', () => {
    expect(tierWeight('fip_gold')).toBe(0.75)
    expect(tierWeight('fip_silver')).toBe(0.70)
    expect(tierWeight('fip_bronze')).toBe(0.65)
  })
  it('case-insensitive', () => {
    expect(tierWeight('P1')).toBe(1.00)
    expect(tierWeight('FIP_BRONZE')).toBe(0.65)
  })
  it('null / unknown → 0.70', () => {
    expect(tierWeight(null)).toBe(0.70)
    expect(tierWeight('amateur')).toBe(0.70)
  })
})

describe('starStrength (by best rank on court)', () => {
  it('top 5 → 1.00', () => {
    expect(starStrength(1)).toBe(1.00)
    expect(starStrength(5)).toBe(1.00)
  })
  it('top 6-15 → 0.75', () => {
    expect(starStrength(6)).toBe(0.75)
    expect(starStrength(15)).toBe(0.75)
  })
  it('top 16-30 → 0.50', () => {
    expect(starStrength(16)).toBe(0.50)
    expect(starStrength(30)).toBe(0.50)
  })
  it('top 31-60 → 0.25', () => {
    expect(starStrength(31)).toBe(0.25)
    expect(starStrength(60)).toBe(0.25)
  })
  it('top 61-100 → 0.10', () => {
    expect(starStrength(61)).toBe(0.10)
    expect(starStrength(100)).toBe(0.10)
  })
  it('> 100 → 0', () => {
    expect(starStrength(101)).toBe(0)
    expect(starStrength(500)).toBe(0)
  })
  it('null → 0', () => {
    expect(starStrength(null)).toBe(0)
  })
})

import { matchQualityScore } from '../match-quality'

describe('matchQualityScore (integration)', () => {
  it('returns an integer in [0, 100]', () => {
    const score = matchQualityScore({
      pair1Rankings: [13, 14],
      pair2Rankings: [50, 44],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(Number.isInteger(score)).toBe(true)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('Salazar/Alonso scenario: top-15 stars vs top-50 R32 in P1 → 60-70', () => {
    // From BA P1 2026-05-12: Salazar(#13)/Alonso(#14) vs Luján(#50)/Nogueira(#44)
    const score = matchQualityScore({
      pair1Rankings: [13, 14],
      pair2Rankings: [50, 44],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(score).toBeGreaterThanOrEqual(60)
    expect(score).toBeLessThanOrEqual(70)
  })

  it('balanced mid-30s R32 in P1 → 60-65 (slightly below star match)', () => {
    // Collombon(#34)/Cabruja(#54) vs Gomez(#37)/Ortiz(#41)
    const score = matchQualityScore({
      pair1Rankings: [34, 54],
      pair2Rankings: [37, 41],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(score).toBeGreaterThanOrEqual(60)
    expect(score).toBeLessThanOrEqual(65)
  })

  it('big mismatch with one star (#33 vs #240 R32 P1) → 25-35', () => {
    // Banchero(#240)/Jimenez(#240) vs Borrero(#43)/Sharifova(#33)
    const score = matchQualityScore({
      pair1Rankings: [240, 240],
      pair2Rankings: [43, 33],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(score).toBeGreaterThanOrEqual(25)
    expect(score).toBeLessThanOrEqual(35)
  })

  it('balanced top-10 Final in P1 → ≥ 90 (the ceiling case)', () => {
    const score = matchQualityScore({
      pair1Rankings: [5, 6],
      pair2Rankings: [7, 8],
      tournamentLevel: 'p1',
      round: 'Final',
    })
    expect(score).toBeGreaterThanOrEqual(90)
  })

  it('balanced FIP Bronze Final at rank ~125 → 65-80 (Prishtina shape)', () => {
    const score = matchQualityScore({
      pair1Rankings: [124, 124],
      pair2Rankings: [129, 128],
      tournamentLevel: 'fip_bronze',
      round: 'Final',
    })
    expect(score).toBeGreaterThanOrEqual(65)
    expect(score).toBeLessThanOrEqual(80)
  })

  it('any unranked player → < 5', () => {
    expect(matchQualityScore({
      pair1Rankings: [13, 14],
      pair2Rankings: [50, null],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })).toBeLessThan(5)

    // All-unranked at a qualifying round — the realistic shape, since
    // a Final with all 4 players unranked doesn't happen in practice.
    expect(matchQualityScore({
      pair1Rankings: [null, null],
      pair2Rankings: [null, null],
      tournamentLevel: 'p1',
      round: 'Q2',
    })).toBeLessThan(5)
  })

  it('unknown round string does not throw and is mid-range', () => {
    const score = matchQualityScore({
      pair1Rankings: [40, 50],
      pair2Rankings: [45, 55],
      tournamentLevel: 'p1',
      round: 'Group Stage',
    })
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })

  it('case-insensitive tier and round inputs', () => {
    const a = matchQualityScore({
      pair1Rankings: [13, 14], pair2Rankings: [50, 44],
      tournamentLevel: 'P1', round: 'Round of 32',
    })
    const b = matchQualityScore({
      pair1Rankings: [13, 14], pair2Rankings: [50, 44],
      tournamentLevel: 'p1', round: 'round of 32',
    })
    expect(a).toBe(b)
  })

  it('FIP Bronze Final at rank 200 — tier × round chains correctly', () => {
    // parity = 1.0, damper(200) ≈ 0.95, bonus = 0 (rank > 100, α(Final) = 0),
    // tier 0.65 × round 1.15 → raw ≈ 1.0 × 0.95 × 0.65 × 1.15 ≈ 0.71 → score 71.
    // Sanity-check the multiplication chain on a balanced mid-rank Final.
    const score = matchQualityScore({
      pair1Rankings: [200, 200],
      pair2Rankings: [200, 200],
      tournamentLevel: 'fip_bronze',
      round: 'Final',
    })
    expect(score).toBeGreaterThanOrEqual(65)
    expect(score).toBeLessThanOrEqual(78)
  })
})

import { matchQualityBreakdown } from '../match-quality'

describe('matchQualityBreakdown', () => {
  it('returns intermediate components alongside the score', () => {
    const b = matchQualityBreakdown({
      pair1Rankings: [13, 14],
      pair2Rankings: [50, 44],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(b).toMatchObject({
      score: expect.any(Number),
      parity: expect.any(Number),
      starDamper: expect.any(Number),
      starBonus: expect.any(Number),
      tierW: expect.any(Number),
      roundW: expect.any(Number),
      unrankedPenalty: 1,
    })
    expect(b.score).toBe(matchQualityScore({
      pair1Rankings: [13, 14], pair2Rankings: [50, 44],
      tournamentLevel: 'p1', round: 'Round of 32',
    }))
  })

  it('flags unrankedPenalty when any player is unranked', () => {
    const b = matchQualityBreakdown({
      pair1Rankings: [13, null],
      pair2Rankings: [50, 44],
      tournamentLevel: 'p1',
      round: 'Round of 32',
    })
    expect(b.unrankedPenalty).toBe(0.15)
  })
})
