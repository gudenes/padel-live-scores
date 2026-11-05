import { cupTeamKey, WORLD_CUP, type CupTeam, type CupTie } from './world-cup'

export const CUP_STREAM_FRESHNESS_MS = 6 * 60 * 1000
export interface CupYouTubeRow {
  video_id: string
  title: string
  started_at: string | null
  last_seen_at: string
}

/** Match official-channel broadcasts to squads. Observation time is never a play date. */
export function matchCupYouTubeStreams(rows: CupYouTubeRow[], teams: CupTeam[], now = new Date()): CupTie[] {
  const ties = new Map<string, CupTie>()
  for (const row of rows) {
    const seen = Date.parse(row.last_seen_at)
    const start = Date.parse(row.started_at ?? '')
    if (!Number.isFinite(seen) || !Number.isFinite(start) || seen > now.getTime() ||
      now.getTime() - seen > CUP_STREAM_FRESHNESS_MS || start > now.getTime()) continue
    if (!/^[\w-]{11}$/.test(row.video_id) || !/\bFIP WORLD CUP 2026\b/i.test(row.title)) continue
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(start))
    if (day < WORLD_CUP.startsOn || day > WORLD_CUP.endsOn) continue
    const gender = row.title.match(/\b(WOMEN|MEN)\b/i)?.[1].toLowerCase()
    if (gender !== 'women' && gender !== 'men') continue
    const language = row.title.match(/^\s*\[(ENG|ESP|POR|FRA|ITA|GER|ARA|EN|ES|PT|FR|IT|DE|AR)\]\s*/i)
    const pair = row.title.slice(language?.[0].length ?? 0).split(/\s+-\s+/)[0].split(/\s+vs\.?\s+/i)
    if (pair.length !== 2) continue
    const squads = pair.map(name => teams.filter(team => team.category === gender && cupTeamKey(team.name) === cupTeamKey(name)))
    if (squads.some(matches => matches.length !== 1)) continue
    const [home, away] = squads.map(matches => matches[0])
    if (!home.country || !away.country || home.country === away.country) continue
    const id = `${day}:${gender}:${[home.country, away.country].sort().join('-')}`
    const previous = ties.get(id)
    if (previous) {
      if (!previous.streams!.some(stream => stream.videoId === row.video_id)) {
        previous.streams!.push({ videoId: row.video_id, language: language?.[1].toUpperCase() ?? null })
      }
    } else {
      ties.set(id, { id, category: gender, group: null, home: home.name, away: away.name,
        scheduledAt: new Date(start).toISOString(), videoId: row.video_id,
        streams: [{ videoId: row.video_id, language: language?.[1].toUpperCase() ?? null }] })
    }
  }
  return [...ties.values()]
}
