import { normalizeCountry } from './country'
import { WORLD_CUP, type CupData } from './world-cup'
import { cupMatchDay, groupCupMatches } from './world-cup-matches'
import type { Match } from '@/types/match'

/** Only offer a national-team destination when both players agree and the squad exists. */
export type CupLinkedMatch = Match & { tournament?: { id?: string } | null; category?: string | null; pair1_player1_country?: string | null; pair1_player2_country?: string | null; pair2_player1_country?: string | null; pair2_player2_country?: string | null }
export function worldCupTeamDestination(match: CupLinkedMatch, pair: 1 | 2, data: CupData | null) {
  if (match.tournament?.id !== WORLD_CUP.tournamentId || !data) return null
  const category = match.category
  if (category !== 'men' && category !== 'women') return null
  const first = normalizeCountry(match[`pair${pair}_player1_country`] ?? match[`pair${pair}_player1`]?.country)
  const second = normalizeCountry(match[`pair${pair}_player2_country`] ?? match[`pair${pair}_player2`]?.country)
  if (!first || first !== second) return null
  const team = data.teams.find(team => team.category === category && normalizeCountry(team.country) === first)
  if (!team) return null
  return { country: first, href: `/tournaments/${WORLD_CUP.tournamentId}?tab=teams&category=${category}&team=${first}&teamView=matches` }
}

export function worldCupSeriesDestination(match: CupLinkedMatch) {
  const { category } = match
  if (match.tournament?.id !== WORLD_CUP.tournamentId || (category !== 'men' && category !== 'women')) return null
  const query = new URLSearchParams({ tab: 'matches', category, match: match.id })
  const day = cupMatchDay(match)
  if (day) query.set('day', day)
  return `/tournaments/${WORLD_CUP.tournamentId}?${query}`
}

export function worldCupNextInSeries(match: CupLinkedMatch, matches: Match[]): string | null {
  if (!worldCupSeriesDestination(match)) return null
  const day = cupMatchDay(match)
  if (!day) return null
  const series = groupCupMatches(matches, match.category as 'men' | 'women', day)
    .find(tie => tie.countries && tie.matches.some(row => row.id === match.id))
  if (!series) return null
  const index = series.matches.findIndex(row => row.id === match.id)
  return series.matches[index + 1]?.id ?? null
}
