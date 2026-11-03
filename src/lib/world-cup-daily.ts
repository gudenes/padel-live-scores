import { normalizeCountry } from './country'
import { cupTeamKey, WORLD_CUP, type CupData, type CupCategory, type CupStream } from './world-cup'
import { cupMatchDay, cupTieScore, groupCupMatches } from './world-cup-matches'
import type { MatchesDayGroup } from './fetch-matches-day'
import type { Match } from '@/types/match'

export interface DailyCupTie {
  key: string
  matches: Match[]
  category: CupCategory
  countries: [string | null, string | null]
  names: [string, string]
  time: string | null
  videoId: string | null
  streams?: CupStream[]
  broadcast: boolean
  score: [number, number] | null
  status: 'live' | 'upcoming' | 'finished'
}
export function dailyCupTies(data: CupData | null, groups: MatchesDayGroup[], iso: string, timeZone: string): DailyCupTie[] {
  const date = (value: string) => new Intl.DateTimeFormat('en-CA', {timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
  const rows = new Map<string, DailyCupTie>()
  for (const tie of data?.ties ?? []) {
    const datedAt = tie.scheduledAt ?? tie.liveObservedAt
    if (!datedAt || date(datedAt) !== iso) continue
    const countries = [tie.home, tie.away].map(name => normalizeCountry(data?.teams.find(team => team.category === tie.category && cupTeamKey(team.name) === cupTeamKey(name))?.country)) as DailyCupTie['countries']
    const key = `${tie.category}:${countries.every(Boolean) ? [...countries].sort().join('-') : tie.id}`
    rows.set(key, {key,category:tie.category,countries,names:[tie.home,tie.away],time:tie.scheduledAt,videoId:tie.videoId,streams:tie.streams,broadcast:true,score:null,matches:[],status:tie.liveObservedAt ? 'live' : 'upcoming'})
  }
  const matches = groups.filter(group => group.tournamentId === WORLD_CUP.tournamentId).flatMap(group => group.matches).map(match => ({...match,sets:match.sets ?? []})) as unknown as Match[]
  for (const category of ['men','women'] as const) {
    for (const day of new Set(matches.map(cupMatchDay))) {
      for (const tie of groupCupMatches(matches,category,day)) {
        if (!tie.countries) continue
        const key = `${category}:${tie.countries.join('-')}`
        const stream = rows.get(key)
        const status = tie.matches.some(m => ['live','on_court'].includes(m.status)) ? 'live' : tie.matches.length >= 3 && tie.matches.every(m => ['finished','ended','retired','walkover'].includes(m.status)) ? 'finished' : 'upcoming'
        rows.set(key,{key,category,videoId:stream?.videoId ?? null,streams:stream?.streams,countries:tie.countries,names:tie.countries,time:tie.matches[0].scheduled_at ?? stream?.time ?? null,broadcast:!tie.matches[0].scheduled_at && !!stream,score:cupTieScore(tie),matches:tie.matches,status})
      }
    }
  }
  return [...rows.values()].sort((a,b) => (a.time ?? '').localeCompare(b.time ?? '') || a.key.localeCompare(b.key))
}
