import { getMatchDisplay, type Match } from '@/types/match'
import { normalizeCountry } from './country'
import type { CupCategory, CupData, CupTie } from './world-cup'

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
export function pairCountry(match: CupMatch, pair: 1 | 2) {
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

/** Keep player and score rows in the same country order as their tie header. */
export function cupPairOrder(match: Match, countries?: readonly (string | null)[] | null): (1 | 2)[] {
  const first = countries?.[0]
  return first && pairCountry(match, 2) === first && pairCountry(match, 1) === countries?.[1]
    ? [2, 1] : [1, 2]
}

/** The published standings order includes the group tie-breaks. */
export function cupQuarterBracket(countries: (string | null)[], category: CupCategory, data: CupData | null): 'title' | 'placement' | 'unknown' {
  if (!data || countries.length !== 2 || countries.some(country => !country)) return 'unknown'
  const positions = countries.map(country => {
    const group = data.groups.find(group => group.category === category && group.teams.some(team => normalizeCountry(team.country) === country))
    if (!group || group.teams.length !== 4) return -1
    return group.teams.findIndex(team => normalizeCountry(team.country) === country)
  })
  if (positions.some(position => position < 0)) return 'unknown'
  if (positions.every(position => position < 2)) return 'title'
  return positions.every(position => position >= 2) ? 'placement' : 'unknown'
}

export function cupCountryPriority(countries: (string | null)[]) {
  if (countries.includes('AR')) return 0
  if (countries.includes('ES')) return 1
  return 2
}

export function cupSemiBracket(countries: (string | null)[], category: CupCategory, data: CupData | null, quarters: CountryConfrontation[]): string {
  if (countries.length !== 2 || countries.some(country => !country)) return 'bracketPending'
  const brackets = countries.map(country => {
    const series = quarters.filter(tie => tie.countries?.includes(country!))
    if (series.length !== 1) return 'bracketPending'
    const tie = series[0]
    const score = cupTieScore(tie)
    if (!score || score.filter(value => value >= 2).length !== 1) return 'bracketPending'
    const winner = score[0] >= 2 ? 0 : 1
    const won = tie.countries![winner] === country
    const bracket = cupQuarterBracket(tie.countries!, category, data)
    if (bracket === 'title') return won ? 'places1to4' : 'places5to8'
    if (bracket === 'placement') return won ? 'places9to12' : 'places13to16'
    return 'bracketPending'
  })
  return brackets[0] === brackets[1] ? brackets[0] : 'bracketPending'
}


/** Observing an undated stream live does not date a knockout fixture. */
export function cupBroadcastOnDay(tie: CupTie, category: CupCategory, day: string) {
  if (tie.category !== category) return false
  const stage = CUP_DAYS.find(entry => entry.date === day)?.stage
  if (stage !== 'groupStage' && (!tie.scheduledAt || tie.group)) return false
  const timestamp = tie.scheduledAt ?? tie.liveObservedAt
  if (!timestamp) return false
  return cupMatchDay({ scheduled_at: timestamp } as Match) === day
}
