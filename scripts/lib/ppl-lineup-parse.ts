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
 * `LEONEL "TOLITO" AGUIRRE` -> `LEONEL AGUIRRE`. Upstream embeds nicknames
 * in both its name fields; Phase 2a hit the same thing when resolving the
 * roster, and the resolver is keyed on the plain name.
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

    const cleaned = c.sides.map((s) => ({
      team: s.team.trim(),
      players: s.players.map(stripLineupNickname).filter(Boolean),
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
