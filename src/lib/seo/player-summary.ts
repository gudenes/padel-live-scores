// src/lib/seo/player-summary.ts
// Pure builder for the server-rendered SEO content block on player pages.

export interface RecentMatchInput {
  tournament_name: string
  round: string | null
  opponents: string[]
  result: string
  played_on: string
}

export interface PlayerSummaryInput {
  name: string
  country: string | null
  category: string | null
  ranking: number | null
  total_matches: number | null
  /** win_rate is a percentage (0-100), matching the schema — NOT a fraction */
  win_rate: number | null
  recent: RecentMatchInput[]
}

export interface PlayerSummary {
  headline: string
  facts: string[]
  recentLines: string[]
}

function categoryWord(category: string | null): string {
  if (category === 'men') return 'men’s'
  if (category === 'women') return 'women’s'
  return ''
}

export function buildPlayerSummary(input: PlayerSummaryInput): PlayerSummary {
  const fromCountry = input.country ? ` from ${input.country}` : ''
  const catWord = categoryWord(input.category)
  const rankingClause =
    input.ranking != null
      ? `, currently ranked #${input.ranking}${catWord ? ` in the ${catWord} circuit` : ''}`
      : ''
  const headline = `${input.name} — professional padel player${fromCountry}${rankingClause}`

  const facts: string[] = []
  if (input.country) facts.push(`Country: ${input.country}`)
  if (input.ranking != null) {
    facts.push(
      `Current ranking: #${input.ranking}${input.category ? ` (${input.category})` : ''}`,
    )
  }
  if (input.total_matches != null) {
    const winRate =
      input.win_rate != null ? ` (${Math.round(input.win_rate)}% win rate)` : ''
    facts.push(`Career: ${input.total_matches} matches${winRate}`)
  }

  const recentLines = input.recent.map((m) => {
    const round = m.round ? ` ${m.round}` : ''
    const opponents = m.opponents.length > 0 ? ` vs ${m.opponents.join(', ')}` : ''
    return `${m.played_on} — ${m.tournament_name}${round}: ${m.result}${opponents}`
  })

  return { headline, facts, recentLines }
}
