import { describe, it, expect } from 'vitest';
import {
  fipPriorElo,
  kFactor,
  decayWeight,
  pairWinProbability,
  toDecimal,
  toAmerican,
  toFractional,
  brierScore,
  logLoss,
  MODEL_VERSION,
} from '../elo-model.js';

describe('fipPriorElo', () => {
  it('rank 1 → 2200', () => {
    expect(fipPriorElo(1)).toBeCloseTo(2200, 1);
  });
  it('rank 10 → ~1950', () => {
    expect(fipPriorElo(10)).toBeCloseTo(1950, 0);
  });
  it('rank 50 → ~1775', () => {
    expect(fipPriorElo(50)).toBeCloseTo(1775, 0);
  });
  it('rank 200 → ~1625', () => {
    expect(fipPriorElo(200)).toBeCloseTo(1625, 0);
  });
  it('rank 1000 → ~1450', () => {
    expect(fipPriorElo(1000)).toBeCloseTo(1450, 0);
  });
  it('null rank → 1300 default', () => {
    expect(fipPriorElo(null)).toBe(1300);
  });
  it('unranked / 0 / negative → 1300', () => {
    expect(fipPriorElo(0)).toBe(1300);
    expect(fipPriorElo(-5)).toBe(1300);
  });
  it('huge rank → floored at 1100', () => {
    expect(fipPriorElo(999_999)).toBe(1100);
  });
});

describe('kFactor', () => {
  it('major → 36', () => expect(kFactor('major')).toBe(36));
  it('p1 → 36', () => expect(kFactor('p1')).toBe(36));
  it('p2 → 30', () => expect(kFactor('p2')).toBe(30));
  it('fip_platinum → 30', () => expect(kFactor('fip_platinum')).toBe(30));
  it('fip_gold → 24', () => expect(kFactor('fip_gold')).toBe(24));
  it('fip_silver → 20', () => expect(kFactor('fip_silver')).toBe(20));
  it('fip_bronze → 14', () => expect(kFactor('fip_bronze')).toBe(14));
  it('null / unknown → 18', () => {
    expect(kFactor(null)).toBe(18);
    expect(kFactor('something_weird')).toBe(18);
  });
});

describe('decayWeight', () => {
  it('0 days → 1.0', () => {
    expect(decayWeight(0, 180)).toBeCloseTo(1.0, 5);
  });
  it('1 halflife → 0.5', () => {
    expect(decayWeight(180, 180)).toBeCloseTo(0.5, 5);
  });
  it('2 halflives → 0.25', () => {
    expect(decayWeight(360, 180)).toBeCloseTo(0.25, 5);
  });
  it('negative age clamped to 0', () => {
    expect(decayWeight(-10, 180)).toBeCloseTo(1.0, 5);
  });
});

describe('pairWinProbability', () => {
  it('equal Elos → 0.5', () => {
    expect(pairWinProbability(2000, 2000)).toBeCloseTo(0.5, 5);
  });
  it('400-point gap → ~0.909 for higher', () => {
    expect(pairWinProbability(2400, 2000)).toBeCloseTo(0.909, 2);
  });
  it('symmetric: P(a beats b) + P(b beats a) = 1', () => {
    const a = pairWinProbability(2100, 1900);
    const b = pairWinProbability(1900, 2100);
    expect(a + b).toBeCloseTo(1, 5);
  });
});

describe('odds conversions', () => {
  it('toDecimal(0.5) = 2.00', () => {
    expect(toDecimal(0.5)).toBeCloseTo(2.0, 2);
  });
  it('toDecimal(0.25) = 4.00', () => {
    expect(toDecimal(0.25)).toBeCloseTo(4.0, 2);
  });
  it('toAmerican(0.819) ≈ -452', () => {
    expect(toAmerican(0.819)).toBe(-452);
  });
  it('toAmerican(0.181) ≈ +452 (mirror of above)', () => {
    expect(toAmerican(0.181)).toBe(452);
  });
  it('toAmerican(0.5) = -100 (boundary favourite)', () => {
    expect(toAmerican(0.5)).toBe(-100);
  });
  it('toFractional(0.5) = 1/1', () => {
    expect(toFractional(0.5)).toBe('1/1');
  });
  it('toFractional(0.8) returns odds-on form (1/4)', () => {
    expect(toFractional(0.8)).toBe('1/4');
  });
});

describe('calibration scoring', () => {
  it('brierScore: perfect prediction = 0', () => {
    expect(brierScore(1.0, 1)).toBeCloseTo(0, 5);
  });
  it('brierScore: worst prediction = 1', () => {
    expect(brierScore(0.0, 1)).toBeCloseTo(1, 5);
  });
  it('brierScore(0.819, 1) ≈ 0.0328', () => {
    expect(brierScore(0.819, 1)).toBeCloseTo(0.0328, 3);
  });
  it('logLoss: perfect (prob=1) → 0', () => {
    expect(logLoss(1.0)).toBeCloseTo(0, 5);
  });
  it('logLoss(0.819) ≈ 0.1997', () => {
    expect(logLoss(0.819)).toBeCloseTo(0.1997, 3);
  });
  it('logLoss clamps near-zero to avoid +Infinity', () => {
    expect(Number.isFinite(logLoss(1e-12))).toBe(true);
  });
});

describe('MODEL_VERSION', () => {
  it('is a non-empty string', () => {
    expect(MODEL_VERSION).toMatch(/^v\d/);
  });
});
