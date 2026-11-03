import { getMatchDisplay, type Match } from '@/types/match'
import { normalizeCountry } from './country'
import type { CupCategory } from './world-cup'

// FIP's published 2026 programme, 23 October 2026:
// https://www.padelfip.com/2026/10/the-worlds-padel-elite-in-doha-from-2-to-7-november-32-national-teams-set-for-the-sports-most-eagerly-awaited-event/
export const CUP_DAYS = [
  { date: '2026-11-02', stage: 'groupStage' },
  { date: '2026-11-03', stage: 'groupStage' },
  { date: '2026-11-04', stage: 'groupStage' },
  { date: '2026-11-05', stage: 'quarterfinals' },
  { date: '2026-11-06', stage: 'semifinals' },
  { date: '2026-11-07', stage: 'finals' },
] as const

type CupMatch = Match & {
  category?: string | null
  court_order?: number | null
  pair1_player1_country?: string | null
  pair1_player2_country?: string | null
  pair2_player1_country?: string | null
  pair2_player2_country?: string | null
}
export function cupMatchDay(match: Match): string | null {
  const value = match.scheduled_at ?? match.started_at ?? match.finished_at
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
function pairCountry(match: CupMatch, pair: 1 | 2) {
  const a = normalizeCountry(match[`pair${pair}_player1_country`] ?? match[`pair${pair}_player1`]?.country)
  const b = normalizeCountry(match[`pair${pair}_player2_country`] ?? match[`pair${pair}_player2`]?.country)
  return a && b && a === b ? a : null
}
export interface CountryConfrontation {
  key: string
  countries: [string, string] | null
  round: string | null
  matches: Match[]
}
/** Date/category scoped; reversed pair orientation belongs to the same country tie. */
export function groupCupMatches(matches: Match[], category: CupCategory, day: string | null): CountryConfrontation[] {
  const groups = new Map<string, CountryConfrontation>()
  for (const match of matches as CupMatch[]) {
    if (match.category !== category || cupMatchDay(match) !== day) continue
    const a = pairCountry(match, 1), b = pairCountry(match, 2)
    const countries = a && b && a !== b ? [a, b].sort() as [string, string] : null
    const key = countries ? `${day}:${category}:${match.round ?? ''}:${countries.join('-')}` : match.id
    let group = groups.get(key)
    if (!group) {
      group = { key, countries, round: match.round, matches: [] }
      groups.set(key, group)
    }
    group.matches.push(match)
  }
  for (const group of groups.values()) group.matches.sort((a, b) =>
    ((a as CupMatch).court_order ?? 999) - ((b as CupMatch).court_order ?? 999) ||
    (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '') || a.id.localeCompare(b.id))
  return [...groups.values()]
}

/** Count completed rubbers in country order, including reversed pair orientation. */
export function cupTieScore(tie: CountryConfrontation): [number, number] | null {
  if (!tie.countries) return null
  const score: [number, number] = [0, 0]
  let known = false
  for (const match of tie.matches) {
    const display = getMatchDisplay(match)
    if (!display.isFinished || !display.winner) continue
    const country = pairCountry(match, display.winner)
    const index = tie.countries.indexOf(country ?? '')
    if (index < 0) continue
    score[index]++
    known = true
  }
  return known ? score : null
}
