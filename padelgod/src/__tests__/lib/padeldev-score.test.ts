import { describe, it, expect } from 'vitest';
import { parsePadeldevScore } from '../../lib/padeldev-score.js';

describe('parsePadeldevScore', () => {
  it('parses a mid-match score: current set games + one completed set', () => {
    // Captured live 2026-09-23, Lyon Piste 3: set 1 went 6-4, now 4-0 in set 2.
    const s = parsePadeldevScore('0-0 4/0 6/4 0/0 0/0');
    expect(s.points).toEqual({ team1: '0', team2: '0' });
    expect(s.currentGames).toEqual({ team1: 4, team2: 0 });
    expect(s.completedSets).toEqual([{ team1: 6, team2: 4 }]);
  });

  it('parses points that are not both zero', () => {
    const s = parsePadeldevScore('30-40 1/0 3/6 0/0 0/0');
    expect(s.points).toEqual({ team1: '30', team2: '40' });
    expect(s.currentGames).toEqual({ team1: 1, team2: 0 });
    expect(s.completedSets).toEqual([{ team1: 3, team2: 6 }]);
  });

  it('treats trailing 0/0 slots as sets not yet played', () => {
    const s = parsePadeldevScore('15-0 1/1 3/6 0/0 0/0');
    expect(s.completedSets).toEqual([{ team1: 3, team2: 6 }]);
  });

  it('parses a finished three-set match', () => {
    // Captured 2026-09-23: lost set 1, won sets 2 and 3.
    const s = parsePadeldevScore('0-0 0/0 3/6 6/2 6/2');
    expect(s.currentGames).toEqual({ team1: 0, team2: 0 });
    expect(s.completedSets).toEqual([
      { team1: 3, team2: 6 },
      { team1: 6, team2: 2 },
      { team1: 6, team2: 2 },
    ]);
  });

  it('parses a finished two-set match', () => {
    const s = parsePadeldevScore('0-0 0/0 6/3 6/2 0/0 ');
    expect(s.completedSets).toEqual([
      { team1: 6, team2: 3 },
      { team1: 6, team2: 2 },
    ]);
  });

  it('tolerates the trailing whitespace the feed emits', () => {
    expect(() => parsePadeldevScore('0-0 0/0 6/2 6/4 0/0 ')).not.toThrow();
  });

  it('reports a 6-6 current set so the caller can infer a tiebreak', () => {
    const s = parsePadeldevScore('5-4 6/6 0/0 0/0 0/0');
    expect(s.currentGames).toEqual({ team1: 6, team2: 6 });
    expect(s.points).toEqual({ team1: '5', team2: '4' });
  });

  it('does not swallow a real completed set that follows an unplayed slot', () => {
    // Defensive: if the feed ever emits a gap, we must not silently reorder.
    // Slots are positional, so a 0/0 gap ends the completed run.
    const s = parsePadeldevScore('0-0 0/0 6/4 0/0 6/2');
    expect(s.completedSets).toEqual([{ team1: 6, team2: 4 }]);
  });

  it('throws on a malformed score string', () => {
    expect(() => parsePadeldevScore('garbage')).toThrow(/padeldev score/i);
    expect(() => parsePadeldevScore('')).toThrow(/padeldev score/i);
    expect(() => parsePadeldevScore('0-0 0/0')).toThrow(/padeldev score/i);
  });
});
