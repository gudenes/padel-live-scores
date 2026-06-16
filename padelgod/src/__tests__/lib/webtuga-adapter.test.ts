import { describe, it, expect } from 'vitest';
import { webtugaToLiveState } from '../../lib/webtuga-adapter.js';
import type { WebtugaFeedRow } from '../../lib/webtuga-types.js';

function row(over: Partial<WebtugaFeedRow> = {}): WebtugaFeedRow {
  return {
    id: 2, court: 'Central Court', time: '10:00', round: 'Qualifiers',
    category: 'Femininos', status: 'Live',
    teamA: 'A. Garcia / C. Sánchez', teamB: 'I. Caño / C. Aguila',
    setsA: 1, setsB: 0, gamesA: 0, gamesB: 0,
    pointsA: '15', pointsB: '0', setsHistoryA: '6', setsHistoryB: '2',
    live: true, finished: false, updatedAt: '2026-06-16T09:36:55',
    ...over,
  };
}

describe('webtugaToLiveState', () => {
  it('builds completed + current sets and current point (AB orientation)', () => {
    const s = webtugaToLiveState(row(), 'uuid-2', 'AB');
    expect(s.matchId).toBe('uuid-2');
    expect(s.matchWidgetId).toBe('2');
    expect(s.status).toBe('live');
    // set 1 completed 6-2, set 2 in progress 0-0
    expect(s.team1Sets).toEqual([{ games: 6, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.team2Sets).toEqual([{ games: 2, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.pointState).toEqual({ kind: 'regular', team1: 15, team2: 0 });
    expect(s.servingTeam).toBeNull(); // no serverTeam on the feed row
  });

  it('swaps A/B under BA orientation', () => {
    const s = webtugaToLiveState(row(), 'uuid-2', 'BA');
    // pair1 (team1) now follows webtuga B-side: 2 games completed, point 0
    expect(s.team1Sets).toEqual([{ games: 2, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.team2Sets).toEqual([{ games: 6, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.pointState).toEqual({ kind: 'regular', team1: 0, team2: 15 });
  });

  it('maps multi-set history (comma-separated)', () => {
    const s = webtugaToLiveState(row({ setsHistoryA: '6,4', setsHistoryB: '3,6', gamesA: 2, gamesB: 1 }), 'u', 'AB');
    expect(s.team1Sets.map((x) => x?.games)).toEqual([6, 4, 2]);
    expect(s.team2Sets.map((x) => x?.games)).toEqual([3, 6, 1]);
  });

  it('maps Scheduled status and is tolerant of empty history', () => {
    const s = webtugaToLiveState(row({ status: 'Scheduled', setsHistoryA: '', setsHistoryB: '', gamesA: 0, gamesB: 0, pointsA: '0', pointsB: '0' }), 'u', 'AB');
    expect(s.status).toBe('scheduled');
    expect(s.team1Sets).toEqual([{ games: 0, tiebreak: null }]);
  });
});
