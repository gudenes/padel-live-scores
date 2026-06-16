/**
 * Pure adapter: a webtuga feed row → the canonical LiveMatchState consumed by
 * diffLiveState/applyDiff. The `orientation` (from the resolver) decides whether
 * webtuga's team A is our pair1 (AB) or pair2 (BA); we always emit team1* = our
 * pair1.
 *
 * THROWS: `parsePointState` rejects any point label outside {0,15,30,40,Ad/AD}.
 * webtuga is an undocumented third-party feed, so a transitional/blank label on
 * a live tick (e.g. "-") will throw. The caller (webtuga-live-fetcher) MUST wrap
 * per-row in try/catch so one bad row can't abort the whole tick.
 *
 * KNOWN v1 LIMITATION — live tiebreak freeze (first fast-follow): this adapter
 * always passes `insideTiebreak=false`, but during a 6-6 tiebreak webtuga's
 * pointsA/B are raw counts ("5"/"7") that `parsePointState` rejects → throws →
 * the caller drops the whole row that tick, so the scoreboard freezes at 6-6
 * until the set completes and `setsHistory` advances (it then catches up). The
 * fast-follow is to fetch `/matches/{id}` for `isTieBreak` (or infer it from
 * gamesA===6 && gamesB===6) and pass it through here.
 */
import {
  parsePointState,
  type LiveMatchState,
  type LiveSetEntry,
} from './live-state.js';
import type { WebtugaFeedRow } from './webtuga-types.js';

function parseHistory(s: string): number[] {
  return (s ?? '')
    .split(/[^0-9]+/)
    .filter((x) => x.length > 0)
    .map((x) => Number(x));
}

/**
 * Build the per-set array: completed sets from history + the current set games.
 * v1 limitation: `tiebreak` is always null (webtuga's setsHistory carries only
 * the games count, not the tiebreak digit), so `currentSetHasTiebreak` in the
 * diff engine will never be true for adapter-sourced state.
 */
function buildSets(history: string, currentGames: number): Array<LiveSetEntry | null> {
  const completed = parseHistory(history).map((g) => ({ games: g, tiebreak: null }));
  return [...completed, { games: currentGames, tiebreak: null }];
}

function mapStatus(raw: string): LiveMatchState['status'] {
  const s = raw.trim().toLowerCase();
  if (s === 'live') return 'live';
  if (s === 'finished') return 'finished';
  return 'scheduled';
}

export function webtugaToLiveState(
  row: WebtugaFeedRow,
  matchId: string,
  orientation: 'AB' | 'BA',
): LiveMatchState {
  // Resolve which webtuga side is our pair1 vs pair2.
  const t1HistoryRaw = orientation === 'AB' ? row.setsHistoryA : row.setsHistoryB;
  const t2HistoryRaw = orientation === 'AB' ? row.setsHistoryB : row.setsHistoryA;
  const t1Games = orientation === 'AB' ? row.gamesA : row.gamesB;
  const t2Games = orientation === 'AB' ? row.gamesB : row.gamesA;
  const t1Points = orientation === 'AB' ? row.pointsA : row.pointsB;
  const t2Points = orientation === 'AB' ? row.pointsB : row.pointsA;

  return {
    matchWidgetId: String(row.id),
    matchId,
    pointState: parsePointState(t1Points || '0', t2Points || '0', false),
    team1Sets: buildSets(t1HistoryRaw, t1Games),
    team2Sets: buildSets(t2HistoryRaw, t2Games),
    servingTeam: null, // feed row carries no server; detail-endpoint enrichment is a later task
    status: mapStatus(row.status),
  };
}
