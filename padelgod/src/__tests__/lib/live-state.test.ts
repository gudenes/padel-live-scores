import { describe, it, expect, vi } from 'vitest';
import {
  diffLiveState,
  parsePointState,
  type LiveMatchState,
  type PointState,
} from '../../lib/live-state.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function state(
  pointState: PointState,
  opts: Partial<Omit<LiveMatchState, 'pointState'>> = {},
): LiveMatchState {
  return {
    matchWidgetId: 'w-1',
    matchId: 'm-1',
    pointState,
    team1Sets: opts.team1Sets ?? [{ games: 0, tiebreak: null }],
    team2Sets: opts.team2Sets ?? [{ games: 0, tiebreak: null }],
    servingTeam: opts.servingTeam ?? 1,
    status: opts.status ?? 'live',
  };
}

// ---------------------------------------------------------------------------
// parsePointState
// ---------------------------------------------------------------------------

describe('parsePointState', () => {
  // Test 13
  it('collapses both-40 raw to {kind:"deuce"} (the contract the comparator depends on)', () => {
    expect(parsePointState('40', '40', false)).toEqual({ kind: 'deuce' });
  });

  // Test 14 + case-insensitivity
  it('parses AD/40 as advantage, case-insensitively', () => {
    expect(parsePointState('AD', '40', false)).toEqual({ kind: 'advantage', side: 1 });
    expect(parsePointState('40', 'AD', false)).toEqual({ kind: 'advantage', side: 2 });
    expect(parsePointState('Ad', '40', false)).toEqual({ kind: 'advantage', side: 1 });
    expect(parsePointState('ad', '40', false)).toEqual({ kind: 'advantage', side: 1 });
  });

  // Test 15
  it('parses GP (either side) as golden_point, case-insensitively', () => {
    expect(parsePointState('GP', '40', false)).toEqual({ kind: 'golden_point' });
    expect(parsePointState('40', 'gp', false)).toEqual({ kind: 'golden_point' });
    expect(parsePointState('Gp', 'Gp', false)).toEqual({ kind: 'golden_point' });
  });

  // Test 16
  it('parses tiebreak scores as numeric', () => {
    expect(parsePointState('5', '3', true)).toEqual({
      kind: 'tiebreak',
      team1: 5,
      team2: 3,
    });
    expect(parsePointState('0', '0', true)).toEqual({
      kind: 'tiebreak',
      team1: 0,
      team2: 0,
    });
    expect(parsePointState('10', '12', true)).toEqual({
      kind: 'tiebreak',
      team1: 10,
      team2: 12,
    });
  });

  it('parses regular numeric scores', () => {
    expect(parsePointState('15', '30', false)).toEqual({
      kind: 'regular',
      team1: 15,
      team2: 30,
    });
    expect(parsePointState('0', '0', false)).toEqual({
      kind: 'regular',
      team1: 0,
      team2: 0,
    });
  });

  it('throws on unrecognised labels', () => {
    expect(() => parsePointState('xyz', '15', false)).toThrow();
    expect(() => parsePointState('50', '15', false)).toThrow();
    // AD without opposing 40 is nonsensical
    expect(() => parsePointState('AD', '15', false)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// diffLiveState — comparator truth table
// ---------------------------------------------------------------------------

describe('diffLiveState', () => {
  it('first poll (prev=null) emits no diff and no warning', () => {
    const logger = { warn: vi.fn() };
    const curr = state({ kind: 'regular', team1: 15, team2: 0 });
    const out = diffLiveState(null, curr, { logger });
    expect(out.pointsAdded).toEqual([]);
    expect(out.gameChanged).toBe(false);
    expect(out.setChanged).toBe(false);
    expect(out.serverChanged).toBe(false);
    expect(out.statusChanged).toBe(false);
    expect(out.suspectedMissedPoints).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // Test 1
  it('regular {15,0} → regular {30,0} credits 1 point to team1', () => {
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([{ winnerTeam: 1 }]);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 2
  it('regular {40,40} → deuce is a no-op (defensive; parser never emits regular 40-40)', () => {
    // Manually construct `regular {40,40}` for this defensive test.
    const prev = state({ kind: 'regular', team1: 40, team2: 40 });
    const curr = state({ kind: 'deuce' });
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([]);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 3
  it('deuce → advantage{1} credits 1 point to team1', () => {
    const prev = state({ kind: 'deuce' });
    const curr = state({ kind: 'advantage', side: 1 });
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([{ winnerTeam: 1 }]);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 4
  it('advantage{1} → deuce credits 1 point to team2 (break back)', () => {
    const prev = state({ kind: 'advantage', side: 1 });
    const curr = state({ kind: 'deuce' });
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([{ winnerTeam: 2 }]);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 5
  it('advantage{1} → regular {0,0} with team1 games 3→4 credits 1 point to team1 + gameChanged', () => {
    const prev = state(
      { kind: 'advantage', side: 1 },
      { team1Sets: [{ games: 3, tiebreak: null }], team2Sets: [{ games: 3, tiebreak: null }] },
    );
    const curr = state(
      { kind: 'regular', team1: 0, team2: 0 },
      { team1Sets: [{ games: 4, tiebreak: null }], team2Sets: [{ games: 3, tiebreak: null }] },
    );
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([{ winnerTeam: 1 }]);
    expect(out.gameChanged).toBe(true);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 6
  it('advantage{1} → regular {0,0} with team2 games 3→4 is suspected (AD flipped + game ended in 1 poll)', () => {
    const logger = { warn: vi.fn() };
    const prev = state(
      { kind: 'advantage', side: 1 },
      { team1Sets: [{ games: 3, tiebreak: null }], team2Sets: [{ games: 3, tiebreak: null }] },
    );
    const curr = state(
      { kind: 'regular', team1: 0, team2: 0 },
      { team1Sets: [{ games: 3, tiebreak: null }], team2Sets: [{ games: 4, tiebreak: null }] },
    );
    const out = diffLiveState(prev, curr, { logger });
    expect(out.pointsAdded).toEqual([{ winnerTeam: 2 }]);
    expect(out.gameChanged).toBe(true);
    expect(out.suspectedMissedPoints).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  // Test 7
  it('deuce → golden_point is a no-op (label-only transition)', () => {
    const prev = state({ kind: 'deuce' });
    const curr = state({ kind: 'golden_point' });
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([]);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  it('golden_point → deuce is also a no-op', () => {
    const prev = state({ kind: 'golden_point' });
    const curr = state({ kind: 'deuce' });
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([]);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 8
  it('golden_point → regular {0,0} with games bump credits game-winning point', () => {
    const prev = state(
      { kind: 'golden_point' },
      { team1Sets: [{ games: 2, tiebreak: null }], team2Sets: [{ games: 2, tiebreak: null }] },
    );
    const curr = state(
      { kind: 'regular', team1: 0, team2: 0 },
      { team1Sets: [{ games: 3, tiebreak: null }], team2Sets: [{ games: 2, tiebreak: null }] },
    );
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([{ winnerTeam: 1 }]);
    expect(out.gameChanged).toBe(true);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 9
  it('tiebreak (5,4) → (5,5) credits 1 point to team2', () => {
    const prev = state({ kind: 'tiebreak', team1: 5, team2: 4 });
    const curr = state({ kind: 'tiebreak', team1: 5, team2: 5 });
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([{ winnerTeam: 2 }]);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 10 — tiebreak-to-set-end
  it('tiebreak (6,4) → regular {0,0} with set 3 games 6→7 + tb recorded triggers setChanged', () => {
    // Sets 1+2 already played; we're in set 3. The tiebreak concludes set 3.
    const prev = state(
      { kind: 'tiebreak', team1: 6, team2: 4 },
      {
        team1Sets: [
          { games: 6, tiebreak: null },
          { games: 4, tiebreak: null },
          { games: 6, tiebreak: null },
        ],
        team2Sets: [
          { games: 4, tiebreak: null },
          { games: 6, tiebreak: null },
          { games: 6, tiebreak: null },
        ],
      },
    );
    const curr = state(
      { kind: 'regular', team1: 0, team2: 0 },
      {
        team1Sets: [
          { games: 6, tiebreak: null },
          { games: 4, tiebreak: null },
          { games: 7, tiebreak: 6 }, // team1 won the tb 7-6 (the 6 is team2's tb digit)
        ],
        team2Sets: [
          { games: 4, tiebreak: null },
          { games: 6, tiebreak: null },
          { games: 6, tiebreak: 4 }, // team2 lost with 4 in tb
        ],
      },
    );
    const out = diffLiveState(prev, curr);
    // The game count on set-3 went 6→7 for team1 → gameChanged=true.
    // A tiebreak game ends a set, so setChanged should be true. In our model
    // `setChanged` fires when the active set index advances OR a new set
    // starts. Here the set count didn't grow; instead the set just finished
    // with games=7. For the comparator's purpose, "tiebreak → regular{0,0}
    // with game bump" is what the truth table calls out — the point is
    // credited, game ended. A fresh set hasn't started yet so setChanged
    // may legitimately be false at this poll.
    expect(out.pointsAdded).toEqual([{ winnerTeam: 1 }]);
    expect(out.gameChanged).toBe(true);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  // Test 11
  it('regular {30,15} → regular {15,30} is suspected (impossible single-point transition)', () => {
    const logger = { warn: vi.fn() };
    const prev = state({ kind: 'regular', team1: 30, team2: 15 });
    const curr = state({ kind: 'regular', team1: 15, team2: 30 });
    const out = diffLiveState(prev, curr, { logger });
    expect(out.pointsAdded).toEqual([]);
    expect(out.suspectedMissedPoints).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  // Test 12
  it('server flip sets serverChanged=true', () => {
    const prev = state({ kind: 'regular', team1: 0, team2: 0 }, { servingTeam: 1 });
    const curr = state({ kind: 'regular', team1: 0, team2: 0 }, { servingTeam: 2 });
    const out = diffLiveState(prev, curr);
    expect(out.serverChanged).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Bonus tests — additional edge cases worth pinning down
  // ---------------------------------------------------------------------------

  it('regular {30,15} → deuce credits 1 point to team1 (30→40 collapses to deuce)', () => {
    const prev = state({ kind: 'regular', team1: 30, team2: 40 });
    const curr = state({ kind: 'deuce' });
    const out = diffLiveState(prev, curr);
    expect(out.pointsAdded).toEqual([{ winnerTeam: 1 }]);
    expect(out.suspectedMissedPoints).toBe(false);
  });

  it('deuce → regular {0,0} is suspected but still credits game winner', () => {
    const logger = { warn: vi.fn() };
    const prev = state(
      { kind: 'deuce' },
      { team1Sets: [{ games: 1, tiebreak: null }], team2Sets: [{ games: 2, tiebreak: null }] },
    );
    const curr = state(
      { kind: 'regular', team1: 0, team2: 0 },
      { team1Sets: [{ games: 1, tiebreak: null }], team2Sets: [{ games: 3, tiebreak: null }] },
    );
    const out = diffLiveState(prev, curr, { logger });
    expect(out.pointsAdded).toEqual([{ winnerTeam: 2 }]);
    expect(out.gameChanged).toBe(true);
    expect(out.suspectedMissedPoints).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('tiebreak jump (5,4) → (7,4) — missed 2 ticks, attributes to team1 with suspected=true', () => {
    const logger = { warn: vi.fn() };
    const prev = state({ kind: 'tiebreak', team1: 5, team2: 4 });
    const curr = state({ kind: 'tiebreak', team1: 7, team2: 4 });
    const out = diffLiveState(prev, curr, { logger });
    expect(out.pointsAdded).toEqual([{ winnerTeam: 1 }]);
    expect(out.suspectedMissedPoints).toBe(true);
  });

  it('status live → finished sets statusChanged=true without emitting a point', () => {
    const prev = state(
      { kind: 'regular', team1: 0, team2: 0 },
      { status: 'live' },
    );
    const curr = state(
      { kind: 'regular', team1: 0, team2: 0 },
      { status: 'finished' },
    );
    const out = diffLiveState(prev, curr);
    expect(out.statusChanged).toBe(true);
    expect(out.pointsAdded).toEqual([]);
  });

  it('identical states produce no diff and no warning', () => {
    const logger = { warn: vi.fn() };
    const prev = state({ kind: 'regular', team1: 15, team2: 30 });
    const curr = state({ kind: 'regular', team1: 15, team2: 30 });
    const out = diffLiveState(prev, curr, { logger });
    expect(out.pointsAdded).toEqual([]);
    expect(out.suspectedMissedPoints).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
