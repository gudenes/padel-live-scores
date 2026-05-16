// Derive winner_pair from a list of set rows. Used by shadow-diff-finalizer
// because Padelgod's live poller doesn't emit matches.winner_pair directly
// — we compute it from the shadow_sets pair1_games / pair2_games counts.

export interface SetRow {
  set_number: number;
  pair1_games: number | null;
  pair2_games: number | null;
  set_score?: string | null;
}

/**
 * A set is "complete" under standard padel/tennis rules:
 *   - 6 games with a 2-game lead (6-0..6-4, 8-6, 10-8 super-tiebreak, etc.), OR
 *   - 7-5 (the only valid 7-game finish without tiebreak), OR
 *   - 7-6 / 6-7 (tiebreak resolved).
 *
 * Anything else (5-3, 6-5, 6-6, 4-4, …) is in-progress and MUST NOT count
 * toward a winner inference — that was the 2026-05-16 Buenos Aires P1
 * incident: a mid-third-set lead got mistaken for a completed set win.
 */
export function isSetComplete(p1: number, p2: number): boolean {
  if (p1 >= 6 && p1 - p2 >= 2) return true;
  if (p2 >= 6 && p2 - p1 >= 2) return true;
  if (p1 === 7 || p2 === 7) return true;
  return false;
}

/**
 * Infer winner_pair by counting completed sets won per team.
 * Returns the team id (1 or 2) that first accumulates 2 set wins.
 * Returns null if neither team has 2 wins among the provided sets.
 *
 * Only sets that satisfy `isSetComplete` are counted. An in-progress set
 * — even one where one team is comfortably ahead — never counts as a win.
 * This is the safe default: an explicit terminal signal (widget status,
 * retired_pair, walkover) must arrive before we can call a match.
 *
 * A null in either games column disqualifies that set from counting.
 */
export function inferWinnerFromSets(sets: SetRow[]): 1 | 2 | null {
  let pair1Sets = 0;
  let pair2Sets = 0;

  for (const s of [...sets].sort((a, b) => a.set_number - b.set_number)) {
    const p1 = s.pair1_games;
    const p2 = s.pair2_games;
    if (p1 == null || p2 == null) continue;
    if (!isSetComplete(p1, p2)) continue;
    if (p1 > p2) pair1Sets += 1;
    else if (p2 > p1) pair2Sets += 1;
  }

  if (pair1Sets >= 2) return 1;
  if (pair2Sets >= 2) return 2;
  return null;
}

/**
 * Concatenate the per-set scores into a single string for side-by-side comparison.
 * Uses set_score when available (e.g. "7-6"), else falls back to "{p1}-{p2}".
 * Returns empty string if no sets.
 */
export function joinedScoreString(sets: SetRow[]): string {
  return [...sets]
    .sort((a, b) => a.set_number - b.set_number)
    .map((s) => s.set_score ?? `${s.pair1_games ?? '?'}-${s.pair2_games ?? '?'}`)
    .join(' ');
}
