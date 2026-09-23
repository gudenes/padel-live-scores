// Shaping for a Pro Padel League franchise page.
//
// A tie is stored two-sidedly — `home_team_season_id` / `away_team_season_id`
// — and its matches encode the sides as pair1 (home) and pair2 (away). A
// franchise page has to show every tie FROM THAT FRANCHISE'S POINT OF VIEW,
// which means flipping roughly half of them.
//
// That flip is the whole reason this file exists as pure functions. Getting
// it wrong does not throw: it silently prints a loss as a win and puts the
// opponent's players under our badge. Phase 2b already shipped exactly that
// bug once — 72 matches written with reversed set scores, because `home` meant
// "scoreboard row" in the parser and "the tie's home franchise" in the caller.
// The lesson taken from it is that the side-resolution has to be a named,
// tested function rather than an inline ternary.

export type Side = 'home' | 'away'

export interface TieMatchInput {
  matchId: string
  category: 'men' | 'women' | null
  /** 1 = the tie's HOME pair won, 2 = the AWAY pair won. Null = undecided. */
  winnerPair: 1 | 2 | null
  homePlayerIds: string[]
  awayPlayerIds: string[]
  /** Set scores as stored, always home-first. */
  sets: Array<{ home: number; away: number }>
}

export interface TieInput {
  tieId: string
  tournamentId: string
  stage: string
  scheduledAt: string | null
  homeSeasonId: string
  awaySeasonId: string
  matches: TieMatchInput[]
}

export interface CourtView {
  matchId: string
  category: 'men' | 'women' | null
  /** Outcome for the franchise whose page this is. */
  result: 'W' | 'L' | null
  ourPlayerIds: string[]
  theirPlayerIds: string[]
  /** Set scores flipped so OUR games come first. */
  sets: Array<{ ours: number; theirs: number }>
}

export interface TieView {
  tieId: string
  tournamentId: string
  stage: string
  scheduledAt: string | null
  side: Side
  opponentSeasonId: string
  /** Courts won by us / by them. */
  ourCourts: number
  theirCourts: number
  result: 'W' | 'L' | 'D' | null
  courts: CourtView[]
}

/**
 * Which side of the tie the given season is on.
 *
 * Returns null when the season is on neither side, rather than defaulting to
 * 'home'. A default would render another franchise's tie as if it were ours,
 * which is worse than omitting it.
 */
export function sideOf(tie: TieInput, seasonId: string): Side | null {
  if (tie.homeSeasonId === seasonId) return 'home'
  if (tie.awaySeasonId === seasonId) return 'away'
  return null
}

/**
 * Re-expresses one tie from a franchise's point of view.
 *
 * Every home/away asymmetry is resolved here — the winner code, the player
 * lists and the set scores all flip together when we are the away side. They
 * must flip together: a partial flip is the failure that shows our players
 * next to their score.
 */
export function viewTie(tie: TieInput, seasonId: string): TieView | null {
  const side = sideOf(tie, seasonId)
  if (!side) return null
  const weAreHome = side === 'home'

  const courts: CourtView[] = tie.matches.map((m) => ({
    matchId: m.matchId,
    category: m.category,
    result: m.winnerPair == null
      ? null
      : (m.winnerPair === 1) === weAreHome ? 'W' : 'L',
    ourPlayerIds: weAreHome ? m.homePlayerIds : m.awayPlayerIds,
    theirPlayerIds: weAreHome ? m.awayPlayerIds : m.homePlayerIds,
    sets: m.sets.map((s) => ({
      ours: weAreHome ? s.home : s.away,
      theirs: weAreHome ? s.away : s.home,
    })),
  }))

  const ourCourts = courts.filter((c) => c.result === 'W').length
  const theirCourts = courts.filter((c) => c.result === 'L').length

  // A tie with nothing decided has no result yet — not a draw. Collapsing
  // those two states would show an upcoming fixture as already drawn.
  const decided = ourCourts + theirCourts
  const result = decided === 0
    ? null
    : ourCourts > theirCourts ? 'W' : ourCourts < theirCourts ? 'L' : 'D'

  return {
    tieId: tie.tieId,
    tournamentId: tie.tournamentId,
    stage: tie.stage,
    scheduledAt: tie.scheduledAt,
    side,
    opponentSeasonId: weAreHome ? tie.awaySeasonId : tie.homeSeasonId,
    ourCourts,
    theirCourts,
    result,
    courts,
  }
}

/**
 * Every tie a franchise played, newest first, from its point of view.
 *
 * Ties the season is not part of are dropped rather than rendered neutrally.
 */
export function viewTies(ties: TieInput[], seasonId: string): TieView[] {
  return ties
    .map((t) => viewTie(t, seasonId))
    .filter((t): t is TieView => t !== null)
    .sort((a, b) => {
      // Undated ties sort last: a fixture with no date is usually a podium
      // slot whose pairing is not known yet, and it belongs below played ties
      // rather than at the top of the list.
      if (!a.scheduledAt && !b.scheduledAt) return 0
      if (!a.scheduledAt) return 1
      if (!b.scheduledAt) return -1
      return b.scheduledAt.localeCompare(a.scheduledAt)
    })
}

export interface SeasonTotals {
  tiesPlayed: number
  tiesWon: number
  courtsWon: number
  courtsLost: number
}

/**
 * Totals derived from the same views the page renders.
 *
 * Deliberately NOT read from team_seasons' stored columns. Those are written
 * by a separate script, and a page that showed stored totals above a list it
 * derived itself could contradict itself on screen with no way for a reader
 * to tell which half was stale.
 */
export function totalsFrom(views: TieView[]): SeasonTotals {
  let tiesPlayed = 0, tiesWon = 0, courtsWon = 0, courtsLost = 0
  for (const v of views) {
    if (v.result === null) continue
    tiesPlayed++
    if (v.result === 'W') tiesWon++
    courtsWon += v.ourCourts
    courtsLost += v.theirCourts
  }
  return { tiesPlayed, tiesWon, courtsWon, courtsLost }
}
