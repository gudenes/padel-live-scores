import { parsePointState, diffLiveState, type LiveMatchState } from './live-state.js';
import { formatPointScore } from './point-reconstruction.js';
import { courtbitPlayerKey, type CourtbitMatch } from './courtbit-client.js';

export type Orientation = 'AB' | 'BA';
export interface CourtbitSnapshot {
  status: 'live' | 'done';
  participants?: import('./courtbit-resolve.js').CourtbitParticipant[];
  orientation: Orientation;
  providerPlayers: string[];
  sets: Array<{ number: number; a: number; b: number; score: string | null; current: boolean }>;
  game: { set: number; number: number; score: string; tiebreak: boolean; servingPair: 1 | 2 | null } | null;
  liveState: LiveMatchState | null;
}

export function courtbitToSnapshot(row: CourtbitMatch, matchId: string, orientation: Orientation): CourtbitSnapshot {
  if (row.status !== 'live' && row.status !== 'done') throw new Error('Not a started CourtBit match');
  const swap = orientation === 'BA';
  const sides = (pair: [number, number]): [number, number] => swap ? [pair[1], pair[0]] : pair;
  const sets: CourtbitSnapshot['sets'] = row.sets.map((pair, i) => {
    const [a, b] = sides(pair);
    if (!((Math.max(a, b) === 6 && Math.min(a, b) <= 4) || (Math.max(a, b) === 7 && [5, 6].includes(Math.min(a, b))))) throw new Error('Incomplete completed set');
    const tb = row.tb[i];
    if (tb != null && !(Math.max(a, b) === 7 && Math.min(a, b) === 6)) throw new Error('Tiebreak on a non-tiebreak set');
    const label = (n: number, opponent: number) => `${n}${tb != null && n < opponent ? `(${tb})` : ''}`;
    return { number: i + 1, a, b, score: `${label(a, b)}-${label(b, a)}`, current: false };
  });
  // No manufactured current set or point when the provider hasn't published it.
  let game: CourtbitSnapshot['game'] = null;
  let liveState: LiveMatchState | null = null;
  if (row.status === 'live' && row.games) {
    if (sets.length >= 3 || row.sets.filter(s => s[0] > s[1]).length >= 2 || row.sets.filter(s => s[1] > s[0]).length >= 2) throw new Error('Live match already has two winning sets');
    const [a, b] = sides(row.games);
    if (a > 6 || b > 6 || (a === 6 && b < 5) || (b === 6 && a < 5)) throw new Error('Completed score published as current set');
    sets.push({ number: sets.length + 1, a, b, score: null, current: true });
    if (row.points) {
      const [p1, p2] = swap ? [row.points[1], row.points[0]] : row.points;
      const tie = a === 6 && b === 6;
      if (tie && ![p1, p2].every(p => /^\d+$/.test(p))) throw new Error('Invalid tiebreak points');
      const pointState = parsePointState(p1, p2, tie);
      const servingPair = row.server === null ? null : (row.server === 'A') !== swap ? 1 : 2;
      game = { set: sets.length, number: a + b + 1, score: formatPointScore(pointState), tiebreak: tie, servingPair };
      liveState = {
        matchId, matchWidgetId: row.id, pointState, servingTeam: servingPair, status: 'live',
        team1Sets: sets.map((s, i) => ({ games: s.a, tiebreak: s.a < s.b ? row.tb[i] ?? null : null })),
        team2Sets: sets.map((s, i) => ({ games: s.b, tiebreak: s.b < s.a ? row.tb[i] ?? null : null })),
      };
    }
  }
  return { status: row.status, orientation, providerPlayers: [...row.a.players, ...row.b.players].map(courtbitPlayerKey), sets, game, liveState };
}

/** Only infer a single point inside the same observed game. Skipped games,
 * corrections, set boundaries and sparse transitions never manufacture history. */
export function observedPointWinner(prev: CourtbitSnapshot | null, curr: CourtbitSnapshot): 1 | 2 | null {
  if (!prev?.liveState || !curr.liveState || !prev.game || !curr.game ||
      prev.orientation !== curr.orientation || JSON.stringify(prev.providerPlayers) !== JSON.stringify(curr.providerPlayers) ||
      prev.game.set !== curr.game.set || prev.game.number !== curr.game.number ||
      JSON.stringify(prev.sets) !== JSON.stringify(curr.sets)) return null;
  if (prev.liveState.pointState.kind === 'tiebreak' && curr.liveState.pointState.kind === 'tiebreak') {
    const a = curr.liveState.pointState.team1 - prev.liveState.pointState.team1;
    const b = curr.liveState.pointState.team2 - prev.liveState.pointState.team2;
    if (!((a === 1 && b === 0) || (a === 0 && b === 1))) return null;
  }
  const diff = diffLiveState(prev.liveState, curr.liveState);
  return diff.suspectedMissedPoints || diff.pointsAdded.length !== 1 ? null : diff.pointsAdded[0]!.winnerTeam;
}
