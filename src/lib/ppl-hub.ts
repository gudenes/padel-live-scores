// Shared vocabulary for the Pro Padel League surfaces.
//
// Two traps live here, both of which would fail silently rather than loudly.
//
// 1. THE DIVISION IS SPELLED TWO WAYS. `tournaments.level` uses `ppl_ii`
//    (underscore, because it is a tier key alongside `fip_gold`), while
//    `team_seasons.league` uses `ppl-ii` (hyphen, because it is upstream's
//    own league id). Joining one to the other without converting yields an
//    empty standings table and no error — the page would simply render
//    "no teams" forever. Every crossing goes through here.
//
// 2. UPSTREAM EVENT NAMES ARE INCONSISTENT. The five rows currently read
//    "New York - PPL", "New York -- PPL II", "Los Angeles",
//    "Los Angeles PPL II" and "Miami". Rendering `tournaments.name` directly
//    puts that raw inconsistency on screen. The slug is regular where the
//    name is not, so the city is derived from the slug.

/** A division, as `tournaments.level` spells it. */
export type PplLevel = 'ppl' | 'ppl_ii'

/** A division, as `team_seasons.league` spells it. */
export type PplLeague = 'ppl' | 'ppl-ii'

export const PPL_LEVELS: readonly PplLevel[] = ['ppl', 'ppl_ii']

export function levelToLeague(level: PplLevel): PplLeague {
  return level === 'ppl_ii' ? 'ppl-ii' : 'ppl'
}

export function leagueToLevel(league: string): PplLevel | null {
  if (league === 'ppl') return 'ppl'
  if (league === 'ppl-ii') return 'ppl_ii'
  return null
}

/** Display name for a division. */
export function divisionLabel(level: PplLevel): string {
  return level === 'ppl_ii' ? 'PPL II' : 'PPL'
}

/**
 * City name for an event, from its slug rather than its name.
 *
 * `new-york-ppl-ii-2026` → `New York`. The division is shown separately, so
 * repeating it in the event title is noise.
 *
 * Returns null for a slug that does not fit the shape, so the caller can fall
 * back to the raw name instead of rendering something mangled.
 */
export function eventCityFromSlug(slug: string | null | undefined): string | null {
  if (!slug) return null
  const stripped = slug
    .replace(/-\d{4}$/, '')      // trailing season year
    .replace(/-ppl(-ii)?$/, '')  // division suffix
  if (!stripped) return null
  const words = stripped.split('-').filter(Boolean)
  // A slug that is nothing but digits has no city in it. Without this the
  // page renders "2026" where a city should be.
  if (words.length === 0 || words.every((w) => /^\d+$/.test(w))) return null
  return words
    .map((w, i) =>
      // Spanish/Portuguese particles stay lowercase inside a name: the city
      // is "Playa del Carmen", not "Playa Del Carmen". Never at position 0,
      // where the particle would be the start of the name.
      i > 0 && LOWERCASE_PARTICLES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const LOWERCASE_PARTICLES = new Set(['del', 'de', 'la', 'las', 'los', 'da', 'do', 'dos', 'das', 'y'])

/**
 * Scopes a division actually has a standing for.
 *
 * PPL II publishes no overall table: each club fields ONE drafted pairing,
 * so a club's overall record and its gendered record are the same thing, and
 * only five of the ten franchises appear in each. Offering an "Overall" tab
 * there would either show half the league or invent a number — upstream
 * itself serves the men's table when asked for `division=teams`.
 */
export function scopesForLevel(level: PplLevel): Array<'all' | 'men' | 'women'> {
  return level === 'ppl_ii' ? ['men', 'women'] : ['all', 'men', 'women']
}

export interface StandingsRow {
  seasonId: string
  teamId: string
  teamName: string
  crestUrl: string | null
  brandColor: string | null
  tiesPlayed: number
  tiesWon: number
  courtsWon: number
  courtsLost: number
}

/**
 * Standings order: ties won, then court difference, then courts won, then
 * name.
 *
 * This is OUR ordering, not the league's. The league seeds on its own points
 * table (25 / 19 / 15 / 12 …) awarded by finishing position, which is not
 * derivable from results — see the note in ppl-standings.ts. Court difference
 * is the honest tiebreak available to us, and the UI must not present the
 * resulting position as an official standing.
 *
 * Name is the final tiebreak purely so the order is stable across renders;
 * without it two identical records would swap places on every re-sort.
 */
export function sortStandings(rows: StandingsRow[]): StandingsRow[] {
  return [...rows].sort((a, b) =>
    b.tiesWon - a.tiesWon ||
    (b.courtsWon - b.courtsLost) - (a.courtsWon - a.courtsLost) ||
    b.courtsWon - a.courtsWon ||
    a.teamName.localeCompare(b.teamName))
}
