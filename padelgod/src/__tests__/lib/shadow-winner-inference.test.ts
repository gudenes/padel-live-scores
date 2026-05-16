import { describe, it, expect } from 'vitest';
import {
  inferWinnerFromSets,
  joinedScoreString,
  type SetRow,
} from '../../lib/shadow-winner-inference.js';

describe('inferWinnerFromSets', () => {
  it('returns 1 when pair1 wins 2 sets in a best-of-3', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: 4, pair2_games: 6 },
      { set_number: 3, pair1_games: 6, pair2_games: 3 },
    ];
    expect(inferWinnerFromSets(sets)).toBe(1);
  });

  it('returns 2 when pair2 wins 2 sets straight', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 3, pair2_games: 6 },
      { set_number: 2, pair1_games: 4, pair2_games: 6 },
    ];
    expect(inferWinnerFromSets(sets)).toBe(2);
  });

  it('returns null when no pair has 2 set wins', () => {
    const sets: SetRow[] = [{ set_number: 1, pair1_games: 6, pair2_games: 4 }];
    expect(inferWinnerFromSets(sets)).toBeNull();
  });

  it('ignores sets with missing game counts (incomplete data)', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: null, pair2_games: null },
    ];
    expect(inferWinnerFromSets(sets)).toBeNull();
  });

  it('tied sets do not count as a win', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 6 }, // incomplete/tied
      { set_number: 2, pair1_games: 6, pair2_games: 3 },
    ];
    expect(inferWinnerFromSets(sets)).toBeNull();
  });

  it('returns null for empty set list', () => {
    expect(inferWinnerFromSets([])).toBeNull();
  });

  // The production-incident scenario (Buenos Aires P1 SF, 2026-05-16): an
  // in-progress set 3 at 3-5 was being counted as a pair2 win and triggered
  // wrong close-on-disappearance behavior in live-poller-loop / close-stale-
  // live-sweeper. Only completed sets (per padel rules) should count.
  it('does NOT count an in-progress set as a win, even when one team leads', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 2 }, // pair1 complete
      { set_number: 2, pair1_games: 5, pair2_games: 7 }, // pair2 complete
      { set_number: 3, pair1_games: 3, pair2_games: 5 }, // in-progress, pair2 leading
    ];
    expect(inferWinnerFromSets(sets)).toBeNull();
  });

  it('does NOT prematurely award the match when set 2 is still in progress at 5-3', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 3 }, // pair1 complete
      { set_number: 2, pair1_games: 5, pair2_games: 3 }, // in-progress, pair1 leading
    ];
    expect(inferWinnerFromSets(sets)).toBeNull();
  });

  it('counts 7-5 and 7-6 as complete (standard padel set wins)', () => {
    expect(
      inferWinnerFromSets([
        { set_number: 1, pair1_games: 7, pair2_games: 5 },
        { set_number: 2, pair1_games: 7, pair2_games: 6 },
      ]),
    ).toBe(1);
  });

  it('does NOT count 6-5 or 6-6 as complete (set still in play)', () => {
    expect(
      inferWinnerFromSets([
        { set_number: 1, pair1_games: 6, pair2_games: 4 },
        { set_number: 2, pair1_games: 6, pair2_games: 5 },
      ]),
    ).toBeNull();
    expect(
      inferWinnerFromSets([
        { set_number: 1, pair1_games: 6, pair2_games: 4 },
        { set_number: 2, pair1_games: 6, pair2_games: 6 },
      ]),
    ).toBeNull();
  });

  it('handles a super-tiebreak final set (e.g. 10-8) as a complete win', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: 3, pair2_games: 6 },
      { set_number: 3, pair1_games: 10, pair2_games: 8 },
    ];
    expect(inferWinnerFromSets(sets)).toBe(1);
  });
});

describe('joinedScoreString', () => {
  it('concatenates per-set scores with space', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4, set_score: '6-4' },
      { set_number: 2, pair1_games: 3, pair2_games: 6, set_score: '3-6' },
      { set_number: 3, pair1_games: 6, pair2_games: 2, set_score: '6-2' },
    ];
    expect(joinedScoreString(sets)).toBe('6-4 3-6 6-2');
  });

  it('falls back to pair1-pair2 when set_score is absent', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: 7, pair2_games: 5 },
    ];
    expect(joinedScoreString(sets)).toBe('6-4 7-5');
  });

  it('returns empty string for empty sets', () => {
    expect(joinedScoreString([])).toBe('');
  });

  it('sorts by set_number regardless of input order', () => {
    const sets: SetRow[] = [
      { set_number: 3, pair1_games: 6, pair2_games: 2, set_score: '6-2' },
      { set_number: 1, pair1_games: 6, pair2_games: 4, set_score: '6-4' },
      { set_number: 2, pair1_games: 3, pair2_games: 6, set_score: '3-6' },
    ];
    expect(joinedScoreString(sets)).toBe('6-4 3-6 6-2');
  });
});
