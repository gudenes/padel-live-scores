import { parsePointState, type LiveMatchState } from './live-state.js';
import type { PuntuateRow } from './puntuate-client.js';

export function puntuateToLiveState(row: PuntuateRow, matchId: string, orientation: 'AB' | 'BA'): LiveMatchState {
  const swap = orientation === 'BA';
  const one = swap ? row.setsB : row.setsA;
  const two = swap ? row.setsA : row.setsB;
  if (!one.length || one.length !== two.length) throw new Error('Missing or unbalanced sets');
  const a = swap ? row.pointsB : row.pointsA;
  const b = swap ? row.pointsA : row.pointsB;
  // Reject missing/unknown points instead of manufacturing a 0-0 score.
  if (!a || !b) throw new Error('Missing point labels');
  const tie = one.at(-1) === 6 && two.at(-1) === 6;
  if (tie && (!/^\d+$/.test(a) || !/^\d+$/.test(b))) throw new Error('Invalid tiebreak points');
  return {
    matchWidgetId: row.id, matchId,
    pointState: parsePointState(a, b, tie),
    team1Sets: one.map(games => ({ games, tiebreak: null })),
    team2Sets: two.map(games => ({ games, tiebreak: null })),
    servingTeam: row.servingTeam === null ? null : swap ? (row.servingTeam === 1 ? 2 : 1) : row.servingTeam,
    status: row.status === 'Live' ? 'live' : row.status === 'Finished' ? 'finished' : 'scheduled',
  };
}
