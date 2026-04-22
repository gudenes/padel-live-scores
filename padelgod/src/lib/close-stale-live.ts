// Pure helpers for the close-stale-live-sweeper worker.
//
// The worker closes matches that have gone silent — status=live/ended in our DB,
// no updates for >15 min, and scheduled_at in the past. By the time we reach
// here the live feed has almost certainly dropped the match (Crionet drops
// finished matches from tournamentlive rather than emitting a terminal state),
// so we infer a winner from whatever sets we already wrote and extrapolate the
// trailing set if needed.
//
// `inferWinnerFromSets` lives in shadow-winner-inference.ts and is reused here
// unchanged — we only add the trailing-set extrapolation on top.

import {
  inferWinnerFromSets,
  type SetRow as InferenceSetRow,
} from './shadow-winner-inference.js';

/**
 * Shape of a `public.sets` row as the sweeper reads it. Same fields as the
 * inference helper plus two columns the sweeper needs to decide what to write.
 */
export interface SetRow extends InferenceSetRow {
  is_current?: boolean | null;
}

export type Pair = 1 | 2;

/**
 * A set is "complete" under standard padel/tennis rules:
 *   - First to 6 games with a 2-game lead (e.g. 6-3, 6-4), OR
 *   - 7-5, OR
 *   - 7-6 (tiebreak — loser at 6, winner at 7)
 */
export function isSetComplete(p1: number, p2: number): boolean {
  if (p1 >= 6 && p1 - p2 >= 2) return true;
  if (p2 >= 6 && p2 - p1 >= 2) return true;
  if (p1 === 7 || p2 === 7) return true;
  return false;
}

export interface FinalSetRow {
  set_number: number;
  pair1_games: number;
  pair2_games: number;
  set_score: string;
  /** True iff this row was trailing/incomplete and got bumped to a final value. */
  extrapolated: boolean;
}

/**
 * Extrapolate the trailing set when the match is closing but the last observed
 * set is still mid-play. Assumes the match winner also won the trailing set
 * (true in virtually every real-world stale-live scenario we'd sweep). Bumps
 * the winner's games to 6, or to 7 when the last-known score was 6-5 / 6-6
 * (tiebreak scenario).
 *
 * Earlier (complete) sets pass through unchanged. Sets with both games null are
 * skipped entirely. Rows are returned ready to upsert into `public.sets`.
 */
export function buildFinalSets(sets: SetRow[], winner: Pair): FinalSetRow[] {
  const sorted = [...sets].sort((a, b) => a.set_number - b.set_number);

  // Find the last set index that has any non-null games — that's the candidate
  // for extrapolation. (Earlier sets are assumed complete; we don't rewrite
  // them even if pair1_games < 6, on the theory that the data is what we got.)
  let lastNonNull = -1;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.pair1_games != null || s.pair2_games != null) lastNonNull = i;
  }

  const out: FinalSetRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.pair1_games == null && s.pair2_games == null) continue;

    let p1 = s.pair1_games ?? 0;
    let p2 = s.pair2_games ?? 0;
    let extrapolated = false;

    if (i === lastNonNull && !isSetComplete(p1, p2)) {
      extrapolated = true;
      if (winner === 1) {
        if (p1 === 6 && p2 >= 5) p1 = 7;
        else if (p1 < 6) p1 = 6;
      } else {
        if (p2 === 6 && p1 >= 5) p2 = 7;
        else if (p2 < 6) p2 = 6;
      }
    }

    out.push({
      set_number: s.set_number,
      pair1_games: p1,
      pair2_games: p2,
      set_score: `${p1}-${p2}`,
      extrapolated,
    });
  }
  return out;
}

// Re-export so callers can grab everything from one module.
export { inferWinnerFromSets };
