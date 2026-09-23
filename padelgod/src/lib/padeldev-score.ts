/**
 * Pure parser for padeldev's packed score string.
 *
 * Grammar (five space-separated slots, often with a trailing space):
 *
 *   "<points> <current-set games> <set1> <set2> <set3>"
 *     "30-40"   "1/0"              "3/6"  "0/0"  "0/0"
 *
 * Two things make this safe to read positionally:
 *
 *  - Slot 1 is ALWAYS the current (in-progress) set's games. A set's own slot
 *    (2..4) stays "0/0" until that set COMPLETES, at which point the games move
 *    into it and slot 1 resets. So the current set is never double-counted.
 *  - "0/0" in slots 2..4 therefore means "not played" — a completed set can
 *    never legitimately be 0-0.
 *
 * Because the slots are positional, a "0/0" gap ENDS the completed-set run
 * rather than being skipped over; silently compacting a gap would reorder sets.
 *
 * Tiebreak detail is NOT encoded — a tiebreak set reads "6/7", never "6/7(5)".
 * Callers that need to know they're inside a tiebreak infer it from
 * `currentGames` being 6-6.
 *
 * Points are returned as RAW strings ("0" | "15" | "30" | "40" | tiebreak
 * counts). Interpreting them is `parsePointState`'s job, not ours.
 */

export interface PadeldevSetScore {
  team1: number;
  team2: number;
}

export interface PadeldevScore {
  /** Raw point labels, uninterpreted. */
  points: { team1: string; team2: string };
  /** Games in the set currently being played. */
  currentGames: PadeldevSetScore;
  /** Completed sets, in order. Empty during set 1. */
  completedSets: PadeldevSetScore[];
}

const SET_SLOTS = 3;

function parsePair(raw: string, sep: string, label: string, whole: string): PadeldevSetScore {
  const parts = raw.split(sep);
  const [left, right] = parts;
  if (parts.length !== 2 || left === undefined || right === undefined) {
    throw new Error(`padeldev score: malformed ${label} "${raw}" in "${whole}"`);
  }
  const team1 = Number(left);
  const team2 = Number(right);
  if (!Number.isFinite(team1) || !Number.isFinite(team2)) {
    throw new Error(`padeldev score: non-numeric ${label} "${raw}" in "${whole}"`);
  }
  return { team1, team2 };
}

export function parsePadeldevScore(raw: string): PadeldevScore {
  const slots = (raw ?? '').trim().split(/\s+/).filter((s) => s.length > 0);
  if (slots.length !== 1 + 1 + SET_SLOTS) {
    throw new Error(
      `padeldev score: expected ${2 + SET_SLOTS} slots, got ${slots.length} in "${raw}"`,
    );
  }

  const [pointsRaw, currentRaw, ...setRaw] = slots;
  // Length is validated above, so these are present; narrow for the compiler.
  if (pointsRaw === undefined || currentRaw === undefined) {
    throw new Error(`padeldev score: missing leading slots in "${raw}"`);
  }

  const pointParts = pointsRaw.split('-');
  const [p1, p2] = pointParts;
  if (pointParts.length !== 2 || p1 === undefined || p2 === undefined) {
    throw new Error(`padeldev score: malformed points "${pointsRaw}" in "${raw}"`);
  }

  const currentGames = parsePair(currentRaw, '/', 'current games', raw);

  // Positional: stop at the first unplayed slot rather than compacting past it.
  const completedSets: PadeldevSetScore[] = [];
  for (const s of setRaw) {
    const set = parsePair(s, '/', 'set games', raw);
    if (set.team1 === 0 && set.team2 === 0) break;
    completedSets.push(set);
  }

  return {
    points: { team1: p1, team2: p2 },
    currentGames,
    completedSets,
  };
}
