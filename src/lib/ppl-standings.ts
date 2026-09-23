// Derives franchise records and division rosters from match results.
//
// Two things upstream gives us that are NOT what they look like:
//
//   1. `teamsById[].mensPlayerIds` / `womensPlayerIds` is the FRANCHISE
//      SQUAD, and the identical list appears in the PPL and the PPL II
//      payloads. Importing it per division claims DC Matrix fielded twelve
//      players in PPL II, where the league's own rule is one drafted pairing
//      per club — and the results agree: every franchise has exactly two
//      players who took the court in PPL II.
//
//   2. The league's published standings points (25, 19, 15, 12 …) are awarded
//      by finishing position, not computed from results. They cannot be
//      derived and are NOT invented here — `points_for`, `points_against` and
//      `ranking` are left alone. A made-up number in those columns would be
//      indistinguishable from the official one.
//
// So this module computes only what the results actually prove: ties played
// and won, and courts (individual matches) won and lost.

export interface TieInput {
  tieId: string
  homeSeasonId: string
  awaySeasonId: string
  /** One entry per match in the tie. `winnerPair` 1 = home, 2 = away. */
  matches: Array<{ winnerPair: 1 | 2 | null; category?: 'men' | 'women' | null }>
}

/**
 * The league keeps standings three ways, because a franchise can top the
 * men's table and sit last in the women's. A scoped table is NOT a filtered
 * view of the overall one — it re-decides each tie on that gender's court
 * alone, so a club that split a tie 1-1 overall shows a clean win in one
 * scope and a clean loss in the other.
 */
export type Scope = 'all' | 'men' | 'women'

export interface SeasonRecord {
  seasonId: string
  tiesPlayed: number
  tiesWon: number
  courtsWon: number
  courtsLost: number
}

/**
 * A tie is won by whoever took more of its courts. A tie split evenly — which
 * happens whenever a franchise wins the men's match and loses the women's —
 * counts as played for both sides and won by neither. The league breaks those
 * ties with its own points system, which we deliberately do not model.
 */
export function computeRecords(ties: TieInput[], scope: Scope = 'all'): Map<string, SeasonRecord> {
  const out = new Map<string, SeasonRecord>()
  const seed = (seasonId: string): SeasonRecord => {
    let r = out.get(seasonId)
    if (!r) {
      r = { seasonId, tiesPlayed: 0, tiesWon: 0, courtsWon: 0, courtsLost: 0 }
      out.set(seasonId, r)
    }
    return r
  }

  for (const tie of ties) {
    const inScope = scope === 'all'
      ? tie.matches
      : tie.matches.filter((m) => m.category === scope)
    const decided = inScope.filter((m) => m.winnerPair === 1 || m.winnerPair === 2)
    // A tie with nothing decided has not been played. Counting it would
    // inflate every franchise's played column the moment a fixture is listed.
    if (decided.length === 0) continue

    const home = seed(tie.homeSeasonId)
    const away = seed(tie.awaySeasonId)
    const homeCourts = decided.filter((m) => m.winnerPair === 1).length
    const awayCourts = decided.length - homeCourts

    home.tiesPlayed++
    away.tiesPlayed++
    home.courtsWon += homeCourts
    home.courtsLost += awayCourts
    away.courtsWon += awayCourts
    away.courtsLost += homeCourts
    if (homeCourts > awayCourts) home.tiesWon++
    else if (awayCourts > homeCourts) away.tiesWon++
  }

  return out
}

export interface ParticipationInput {
  seasonId: string
  /** Player ids that appeared in a match belonging to a tie of this season. */
  playerIds: string[]
  /** Did this side win that match? Null when the match has no winner yet. */
  won: boolean | null
}

export interface PlayerRecord {
  gamesPlayed: number
  wins: number
  losses: number
}

/**
 * Roster per division with each player's record, from who actually took the
 * court.
 *
 * This replaces the squad block, which is franchise-wide and cannot tell the
 * two divisions apart. The trade-off is explicit: a squad member who has not
 * played yet does not appear. That is the honest failure — it under-reports a
 * reserve, where the squad block over-reports by claiming a whole roster
 * played in a division that fields one pair.
 *
 * An undecided match still counts the player onto the roster — they were
 * named in the lineup — but does not move wins or losses, so
 * `wins + losses <= gamesPlayed` rather than always equal.
 */
export function computePlayerRecords(
  rows: ParticipationInput[],
): Map<string, Map<string, PlayerRecord>> {
  const out = new Map<string, Map<string, PlayerRecord>>()
  for (const r of rows) {
    let season = out.get(r.seasonId)
    if (!season) { season = new Map(); out.set(r.seasonId, season) }
    for (const p of r.playerIds) {
      let rec = season.get(p)
      if (!rec) { rec = { gamesPlayed: 0, wins: 0, losses: 0 }; season.set(p, rec) }
      rec.gamesPlayed++
      if (r.won === true) rec.wins++
      else if (r.won === false) rec.losses++
    }
  }
  return out
}
