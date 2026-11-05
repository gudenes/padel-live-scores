import { normalizeCountry } from './country'
import { WORLD_CUP, type CupData } from './world-cup'
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
  return { country: first, href: `/tournaments/${WORLD_CUP.tournamentId}?tab=teams&category=${category}&team=${first}` }
}
