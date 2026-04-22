import { describe, it, expect } from 'vitest';
import {
  buildFinalSets,
  isSetComplete,
  inferWinnerFromSets,
  type SetRow,
} from '../../lib/close-stale-live.js';

describe('isSetComplete', () => {
  it('6-0, 6-4 count as complete', () => {
    expect(isSetComplete(6, 0)).toBe(true);
    expect(isSetComplete(6, 4)).toBe(true);
  });

  it('6-5 is NOT complete (needs 2-game lead)', () => {
    expect(isSetComplete(6, 5)).toBe(false);
  });

  it('7-5 is complete', () => {
    expect(isSetComplete(7, 5)).toBe(true);
    expect(isSetComplete(5, 7)).toBe(true);
  });

  it('7-6 tiebreak is complete', () => {
    expect(isSetComplete(7, 6)).toBe(true);
    expect(isSetComplete(6, 7)).toBe(true);
  });

  it('early scores are not complete', () => {
    expect(isSetComplete(3, 2)).toBe(false);
    expect(isSetComplete(0, 0)).toBe(false);
    expect(isSetComplete(5, 4)).toBe(false);
  });

  it('6-6 (tiebreak in progress) is not yet complete', () => {
    expect(isSetComplete(6, 6)).toBe(false);
  });
});

describe('buildFinalSets', () => {
  it('passes through straight-set wins unchanged', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 3 },
      { set_number: 2, pair1_games: 6, pair2_games: 2 },
    ];
    const out = buildFinalSets(sets, 1);
    expect(out).toEqual([
      {
        set_number: 1,
        pair1_games: 6,
        pair2_games: 3,
        set_score: '6-3',
        extrapolated: false,
      },
      {
        set_number: 2,
        pair1_games: 6,
        pair2_games: 2,
        set_score: '6-2',
        extrapolated: false,
      },
    ]);
  });

  it('extrapolates trailing incomplete set to 6 for pair1 winner (5-0 → 6-0)', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: 5, pair2_games: 0 },
    ];
    const out = buildFinalSets(sets, 1);
    expect(out[1]).toEqual({
      set_number: 2,
      pair1_games: 6,
      pair2_games: 0,
      set_score: '6-0',
      extrapolated: true,
    });
  });

  it('extrapolates trailing incomplete set to 6 for pair2 winner (2-5 → 2-6)', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 4, pair2_games: 6 },
      { set_number: 2, pair1_games: 2, pair2_games: 5 },
    ];
    const out = buildFinalSets(sets, 2);
    expect(out[1]).toEqual({
      set_number: 2,
      pair1_games: 2,
      pair2_games: 6,
      set_score: '2-6',
      extrapolated: true,
    });
  });

  it('extrapolates 6-5 → 7-5 when pair1 is winner', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 3, pair2_games: 6 },
      { set_number: 2, pair1_games: 6, pair2_games: 4 },
      { set_number: 3, pair1_games: 6, pair2_games: 5 },
    ];
    const out = buildFinalSets(sets, 1);
    expect(out[2]).toEqual({
      set_number: 3,
      pair1_games: 7,
      pair2_games: 5,
      set_score: '7-5',
      extrapolated: true,
    });
  });

  it('extrapolates 6-6 → 7-6 (tiebreak) when the trailing team is the winner', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: 3, pair2_games: 6 },
      { set_number: 3, pair1_games: 6, pair2_games: 6 },
    ];
    const out = buildFinalSets(sets, 1);
    expect(out[2]).toEqual({
      set_number: 3,
      pair1_games: 7,
      pair2_games: 6,
      set_score: '7-6',
      extrapolated: true,
    });
  });

  it('skips sets where both games are null', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 3 },
      { set_number: 2, pair1_games: 6, pair2_games: 4 },
      { set_number: 3, pair1_games: null, pair2_games: null },
    ];
    const out = buildFinalSets(sets, 1);
    expect(out).toHaveLength(2);
    expect(out[out.length - 1]!.set_number).toBe(2);
  });

  it('sorts by set_number regardless of input order', () => {
    const sets: SetRow[] = [
      { set_number: 3, pair1_games: 5, pair2_games: 3 },
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: 3, pair2_games: 6 },
    ];
    const out = buildFinalSets(sets, 1);
    expect(out.map((s) => s.set_number)).toEqual([1, 2, 3]);
    // Last set got extrapolated (5 → 6).
    expect(out[2]!.pair1_games).toBe(6);
    expect(out[2]!.extrapolated).toBe(true);
  });

  it('leaves trailing set alone if already complete (no false extrapolation)', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: 3, pair2_games: 6 },
      { set_number: 3, pair1_games: 7, pair2_games: 5 },
    ];
    const out = buildFinalSets(sets, 1);
    expect(out[2]!.extrapolated).toBe(false);
    expect(out[2]!.pair1_games).toBe(7);
    expect(out[2]!.pair2_games).toBe(5);
  });

  it('re-exports inferWinnerFromSets for convenience', () => {
    expect(
      inferWinnerFromSets([
        { set_number: 1, pair1_games: 6, pair2_games: 3 },
        { set_number: 2, pair1_games: 6, pair2_games: 2 },
      ]),
    ).toBe(1);
  });
});
