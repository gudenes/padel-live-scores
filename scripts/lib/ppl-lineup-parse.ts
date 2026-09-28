// Parses the line-ups the Pro Padel League publishes on an event's schedule
// page, so a fixture stops rendering as "TBD vs TBD" once the pairings are
// named.
//
// WHERE THIS COMES FROM
//
// The static payload publishes the FIXTURE — which franchises meet, when —
// but never the line-up. The line-up appears only in the rendered schedule
// page, a day or so before play. One page carries the whole day, which is
// why this reads the schedule rather than 24 individual match pages.
//
// THE SHAPE, measured on 2026-09-24 (Playa del Carmen, day 1):
//
//   .session                       one per session (NIGHT · SESSION #1)
//     .matchgroup                  one per TIE ("MATCHUP #1")
//       .cc-upcoming-match         one per gender within the tie
//         .cc-live-match__row      ONE row holding BOTH sides
//           .cc-live-match__team   x2 — rank, franchise, players
//
// The row/team distinction matters: iterating `.cc-live-match__row` finds
// one element per match and yields only the home side, which looks like a
// working scrape right up until half the pairings are missing.

/** One franchise's side of a court, as lifted from the DOM. */
export interface RawLineupSide {
  rank: string
  team: string
  players: string[]
}

export interface RawLineupCourt {
  stage: string
  label: string
  gender: string
  sides: RawLineupSide[]
}

export interface ParsedLineupCourt {
  /** Upstream's tie label, e.g. "MATCHUP #1". */
  label: string
  stage: string
  category: 'men' | 'women'
  home: { team: string; players: string[] }
  away: { team: string; players: string[] }
}

export interface LineupProblem {
  label: string
  gender: string
  reason: string
  detail: string
}

/**
 * Strips a quoted nickname from a published name.
 *
 * KEPT BUT NO LONGER APPLIED ON THE MAIN PATH, and the reason is worth
 * recording: the obvious move is to strip `LEONEL "TOLITO" AGUIRRE` down to
 * `LEONEL AGUIRRE` before matching. That is backwards here. Upstream's own
 * player registry stores the nickname form (`Leonel "Tolito" Aguirre`), and
 * so does our players row for him, so stripping destroys the very match it
 * was meant to enable. The resolver keys on a normalisation that drops
 * punctuation instead, which makes both forms converge without losing a
 * token. This stays for callers that genuinely need the bare legal name.
 */
export function stripLineupNickname(name: string): string {
  return name
    .replace(/["“”'‘’]([^"“”'‘’]*)["“”'‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normaliseGender(g: string): 'men' | 'women' | null {
  const s = g.trim().toLowerCase()
  if (s.startsWith("men")) return 'men'
  if (s.startsWith("women")) return 'women'
  return null
}

/**
 * Turns raw DOM rows into pairings, and REFUSES anything ambiguous.
 *
 * A padel court is two players a side. Upstream published a side with three
 * on day 1 of Playa del Carmen — an alternate listed alongside the pair.
 * There is no way to tell from the page which two actually start, and
 * "take the first two" would write a plausible, unverifiable, possibly
 * wrong pairing into a player's permanent history. Those courts are
 * reported instead, so an operator sees them rather than a silent guess.
 */
export function parseLineups(
  courts: RawLineupCourt[],
): { parsed: ParsedLineupCourt[]; problems: LineupProblem[] } {
  const parsed: ParsedLineupCourt[] = []
  const problems: LineupProblem[] = []

  for (const c of courts) {
    const category = normaliseGender(c.gender)
    if (!category) {
      problems.push({ label: c.label, gender: c.gender, reason: 'unknown-gender', detail: c.gender })
      continue
    }
    if (c.sides.length !== 2) {
      problems.push({
        label: c.label, gender: c.gender, reason: 'wrong-side-count',
        detail: `${c.sides.length} side(s): ${c.sides.map((s) => s.team).join(' / ')}`,
      })
      continue
    }

    // Names are kept VERBATIM. See stripLineupNickname's note: upstream's
    // registry carries the nickname, so removing it here would break the
    // lookup rather than help it.
    const cleaned = c.sides.map((s) => ({
      team: s.team.trim(),
      players: s.players.map((p) => p.trim()).filter(Boolean),
    }))

    const bad = cleaned.find((s) => s.players.length !== 2)
    if (bad) {
      problems.push({
        label: c.label, gender: c.gender, reason: 'not-a-pair',
        detail: `${bad.team}: ${bad.players.length} named — ${bad.players.join(', ')}`,
      })
      continue
    }

    parsed.push({
      label: c.label,
      stage: c.stage.trim(),
      category,
      home: cleaned[0],
      away: cleaned[1],
    })
  }

  return { parsed, problems }
}

/** Normalises a franchise name for comparison: case and spacing only. */
function teamKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface AlignedLineup {
  /** Players for the side OUR tie calls home (pair1). */
  homePlayers: string[]
  /** Players for the side OUR tie calls away (pair2). */
  awayPlayers: string[]
  /** True when upstream listed the franchises the other way round. */
  flipped: boolean
}

/**
 * Re-orients a published line-up onto OUR tie's home/away.
 *
 * Upstream lists whichever franchise it likes first; our tie already fixed a
 * home and an away when it was imported, and `matches.pair1_*` means the
 * tie's home. If those disagree and nobody notices, the pairs get written to
 * the wrong franchises — every player attached to the opponent, every result
 * inverted downstream.
 *
 * This is the third place in this feature where a home/away mismatch could
 * silently invert data (the score parser and the franchise page were the
 * others), so it gets the same treatment: a named function that refuses when
 * the teams do not match at all, rather than falling back to positional order.
 */
export function alignLineupToTie(
  court: ParsedLineupCourt,
  tieHomeTeam: string,
  tieAwayTeam: string,
): AlignedLineup | null {
  const h = teamKey(court.home.team)
  const a = teamKey(court.away.team)
  const th = teamKey(tieHomeTeam)
  const ta = teamKey(tieAwayTeam)

  if (h === th && a === ta) {
    return { homePlayers: court.home.players, awayPlayers: court.away.players, flipped: false }
  }
  if (h === ta && a === th) {
    return { homePlayers: court.away.players, awayPlayers: court.home.players, flipped: true }
  }
  return null
}
