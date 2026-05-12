// src/lib/seo/match-summary.ts
// Pure builder for the server-rendered SEO content block on match pages.
// Takes a normalized MatchSummaryInput (no DB types, no joins) so it can be
// unit-tested without Supabase mocks. Layout wires the DB → input mapping.

export interface MatchSummaryInput {
  status: string | null
  round: string | null
  winner_pair: number | null
  scheduled_at: string | null
  finished_at: string | null
  pair1: { names: string[] }
  pair2: { names: string[] }
  sets: Array<{ set_number: number; pair1_games: number | null; pair2_games: number | null }>
  tournament: {
    name: string
    country: string | null
    level: string | null
  }
}

export interface MatchSummary {
  /** Single-sentence headline suitable for an <h1> or the first <p>. */
  headline: string
  /** Independent factual sentences for a <ul> or sequential <p>s. */
  facts: string[]
}

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
}

function shortPair(names: string[]): string {
  return names.map(lastName).join(' / ')
}

function scoreString(sets: MatchSummaryInput['sets']): string {
  return sets
    .slice()
    .sort((a, b) => a.set_number - b.set_number)
    .map((s) => `${s.pair1_games ?? '?'}-${s.pair2_games ?? '?'}`)
    .join(', ')
}

export function buildMatchSummary(input: MatchSummaryInput): MatchSummary {
  const p1 = shortPair(input.pair1.names)
  const p2 = shortPair(input.pair2.names)
  const tournamentName = input.tournament.name
  const round = input.round?.trim() || null
  const roundClause = round ? `in the ${round} of ${tournamentName}` : `at ${tournamentName}`

  let headline: string
  if (input.status === 'live') {
    headline = `${p1} vs ${p2} — live now ${roundClause}`
  } else if (input.winner_pair === 1 || input.winner_pair === 2) {
    const winner = input.winner_pair === 1 ? p1 : p2
    const loser = input.winner_pair === 1 ? p2 : p1
    const score = scoreString(input.sets)
    headline = score
      ? `${winner} defeated ${loser} ${score} ${roundClause}`
      : `${winner} defeated ${loser} ${roundClause}`
  } else {
    headline = `${p1} vs ${p2} ${roundClause}`
  }

  const facts: string[] = []
  facts.push(
    `Tournament: ${tournamentName}${input.tournament.country ? ` (${input.tournament.country})` : ''}`,
  )
  if (round) facts.push(`Round: ${round}`)
  if (input.tournament.level) facts.push(`Level: ${input.tournament.level.toUpperCase()}`)

  const playedAt = input.finished_at ?? input.scheduled_at
  if (playedAt) {
    const date = new Date(playedAt).toISOString().slice(0, 10)
    facts.push(`Played on ${date}`)
  }

  if (input.sets.length > 0) {
    facts.push(`Sets: ${scoreString(input.sets)}`)
  }

  if (input.status === 'retired') {
    facts.push('Match ended — one pair retired')
  } else if (input.status === 'walkover') {
    facts.push('Match was a walkover')
  }

  return { headline, facts }
}
