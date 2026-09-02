import { describe, it, expect } from 'vitest';
import {
  computePointsMove,
  previousIsoYearWeek,
  resolvePreviousPoints,
} from '../points-move.js';

describe('computePointsMove', () => {
  it('gained points → positive delta', () => {
    expect(computePointsMove(21000, 20550)).toBe(450);
  });

  it('lost points → negative delta', () => {
    expect(computePointsMove(17669, 17749)).toBe(-80);
  });

  it('unchanged points → 0', () => {
    expect(computePointsMove(7800, 7800)).toBe(0);
  });

  it('no previous points → null (UI shows --)', () => {
    expect(computePointsMove(7800, null)).toBeNull();
    expect(computePointsMove(7800, undefined)).toBeNull();
  });
});

describe('previousIsoYearWeek', () => {
  it('subtracts one week inside the same year', () => {
    expect(previousIsoYearWeek(2026, 10)).toEqual({ year: 2026, week: 9 });
  });

  it('wraps year boundary: 2026-W01 → 2025-W52', () => {
    expect(previousIsoYearWeek(2026, 1)).toEqual({ year: 2025, week: 52 });
  });
});

describe('resolvePreviousPoints', () => {
  it('prefers last-week snapshot over the live players.points column', () => {
    expect(resolvePreviousPoints({
      snapshotPoints: 20550,
      currentPlayerPoints: 21000,
      currentRankingDate: '2026-06-15',
      newRankingDate: '2026-06-15',
    })).toBe(20550);
  });

  it('falls back to players.points when there is no snapshot and the ranking date changed', () => {
    expect(resolvePreviousPoints({
      snapshotPoints: null,
      currentPlayerPoints: 20550,
      currentRankingDate: '2026-06-08',
      newRankingDate: '2026-06-15',
    })).toBe(20550);
  });

  it('does not treat same-week players.points as last week (re-run guard)', () => {
    expect(resolvePreviousPoints({
      snapshotPoints: null,
      currentPlayerPoints: 21000,
      currentRankingDate: '2026-06-15T00:00:00Z',
      newRankingDate: '2026-06-15',
    })).toBeNull();
  });

  it('returns null when nothing historical exists', () => {
    expect(resolvePreviousPoints({
      snapshotPoints: null,
      currentPlayerPoints: null,
      currentRankingDate: null,
      newRankingDate: '2026-06-15',
    })).toBeNull();
  });
});
