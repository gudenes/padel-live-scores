// Team-league tournament levels.
//
// These are franchise leagues (Pro Padel League), not the individual
// circuit. Their matches ARE stored in `matches` with real player FKs so
// they appear in a player's history — but they must never feed circuit
// metrics: win rate, W-L record, titles, Elo, predictions, prize money.
//
// A different format (team ties, super-tiebreak third set) scored into
// the same numbers as FIP/Premier results would corrupt them.
//
// MIRRORED at padelgod/src/lib/league-levels.ts — padelgod is a separate
// npm package and cannot import from src/. The two files must stay
// byte-identical; a test in src/lib/__tests__/league-levels.test.ts
// enforces it.
//
// Adding a new team league? Add its level here and every gate picks it
// up. Do NOT add circuit tiers to this set.

export const LEAGUE_LEVELS: ReadonlySet<string> = new Set(['ppl', 'ppl_ii'])

export function isLeagueLevel(level: string | null | undefined): boolean {
  if (!level) return false
  return LEAGUE_LEVELS.has(level.toLowerCase())
}

/**
 * Splits finished matches into the circuit-only set and the full set.
 *
 * This is the guard behind the product decision that team-league results
 * appear in a player's history but never in their win rate, W-L record or
 * partner stats. It lives here as a pure function purely so it can be
 * tested — inside the player page it was a single `.filter` in a 2600-line
 * component's useMemo, which nothing could assert on.
 */
export function partitionLeagueMatches<
  T extends { tournament?: { level?: string | null } | null },
>(rows: T[]): { circuit: T[]; all: T[] } {
  return { circuit: rows.filter((r) => !isLeagueLevel(r.tournament?.level)), all: rows }
}
