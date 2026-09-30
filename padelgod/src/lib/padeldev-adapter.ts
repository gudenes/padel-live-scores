/**
 * Pure adapter: a padeldev per-match feed → the canonical LiveMatchState that
 * diffLiveState/applyDiff consume.
 *
 * `orientation` (from the resolver) says whether padeldev's team A — players
 * 1 & 2, and the LEFT side of every score pair — is our pair1 (AB) or our
 * pair2 (BA). We always emit team1* = our pair1.
 *
 * THROWS on a malformed score string or an unparseable point label. padeldev is
 * an undocumented third-party feed, so the caller MUST wrap per-match in
 * try/catch — one bad row must not abort the whole tick.
 *
 * Two things this handles that the webtuga adapter does not:
 *
 *  - SERVING TEAM. The feed carries `score.teamserving`, so servingTeam is real
 *    rather than null. That matters beyond display: it's what populates
 *    `server_player_id`, the column the UI's point-by-point detection keys on.
 *  - TIEBREAKS. webtuga's v1 throws on tiebreak point labels and freezes the
 *    scoreboard at 6-6 until the set ends. padeldev doesn't flag a tiebreak
 *    either, but the current-set games being 6-6 is a reliable proxy, so we
 *    pass `insideTiebreak` through and the score keeps moving.
 */
import { parsePointState, type LiveMatchState, type LiveSetEntry } from './live-state.js';
import { parsePadeldevScore, type PadeldevSetScore } from './padeldev-score.js';
import type { PadeldevMatchFeed } from './padeldev-types.js';

/**
 * padeldev writes advantage as a bare "A" ("A-40" / "40-A"), while
 * `parsePointState` only recognises "AD". Observed live on 2026-09-23 at Lyon.
 *
 * This is normalised HERE rather than in live-state.ts on purpose: that module
 * is shared with the Crionet live-poller, and widening its vocabulary for one
 * vendor's dialect would change how the Premier path parses scores too.
 *
 * Without this, every advantage point throws, the worker drops the row, and the
 * scoreboard visibly freezes at deuce until the game ends.
 */
function normalizeAdvantage(label: string): string {
  return /^ad?$/i.test(label.trim()) ? 'AD' : label;
}

/**
 * Build one team's per-set array.
 *
 * The in-progress set is appended only while the match is live — on a finished
 * match the current-games slot has already reset to 0/0 and appending it would
 * invent a phantom fourth set.
 *
 * `tiebreak` is always null: padeldev encodes a tiebreak set as "6/7", never
 * "6/7(5)", so the digit simply isn't available.
 */
function buildSets(
  completed: PadeldevSetScore[],
  current: PadeldevSetScore,
  side: 'team1' | 'team2',
  finished: boolean,
): Array<LiveSetEntry | null> {
  const sets: Array<LiveSetEntry | null> = completed.map((s) => ({
    games: s[side],
    tiebreak: null,
  }));
  if (!finished) sets.push({ games: current[side], tiebreak: null });
  return sets;
}

export function padeldevToLiveState(
  feed: PadeldevMatchFeed,
  matchId: string,
  orientation: 'AB' | 'BA',
): LiveMatchState {
  const parsed = parsePadeldevScore(feed.score?.value ?? '');
  const finished = Number(feed.isfinished) === 1;
  const swap = orientation === 'BA';

  const ours = <T>(a: T, b: T): T => (swap ? b : a);

  // A 6-6 current set means the game in play is the tiebreak, where padeldev's
  // point labels are raw counts ("5"/"3") rather than 15/30/40.
  const insideTiebreak =
    parsed.currentGames.team1 === 6 && parsed.currentGames.team2 === 6;

  // `score.starpoint` is deliberately IGNORED.
  //
  // The field name suggests a golden point, and an early draft mapped it to
  // parsePointState's golden-point path. Captured live traffic disproved that:
  //
  //     40-40  starpoint=1     first deuce
  //     A-40   starpoint=1
  //     40-40  starpoint=2     back to deuce
  //     40-A   starpoint=2
  //     40-40  starpoint=3     third deuce
  //
  // It is a DEUCE COUNTER, not a flag. Treating it as golden point would have
  // relabelled every deuce and advantage in the match. Traditional advantage
  // scoring is what this feed actually emits.
  const rawP1 = normalizeAdvantage(ours(parsed.points.team1, parsed.points.team2));
  const rawP2 = normalizeAdvantage(ours(parsed.points.team2, parsed.points.team1));

  const pointState = parsePointState(rawP1, rawP2, insideTiebreak);

  const teamServingRaw = Number(feed.score?.teamserving);
  const servingTeam: 1 | 2 | null =
    teamServingRaw === 1 ? ours(1, 2) : teamServingRaw === 2 ? ours(2, 1) : null;

  return {
    matchWidgetId: feed.idmatch,
    matchId,
    pointState,
    team1Sets: buildSets(parsed.completedSets, parsed.currentGames, ours('team1', 'team2'), finished),
    team2Sets: buildSets(parsed.completedSets, parsed.currentGames, ours('team2', 'team1'), finished),
    servingTeam,
    status: finished ? 'finished' : 'live',
  };
}
