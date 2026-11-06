import { cupTeamKey, type CupTie } from './world-cup'

// Verified snapshot of the official 6 November order of play, version 3.
// This is a country-tie schedule, not a player lineup or live-status source.
// Update this snapshot if FIP publishes a revised order of play.
export const CUP_SCHEDULE_SOURCE = 'https://www.padelfip.com/wp-content/uploads/2026/07/ORDER-OF-PLAY-FRIDAY-6-NOVEMBER-2026-v3.pdf'
export const CUP_SEMIFINALS: CupTie[] = [
  ['women', 'Spain', 'France', 'ES', 'FR', 'Center Court'],
  ['women', 'Argentina', 'Italy', 'AR', 'IT', 'Grand Stand 1'],
  ['men', 'Argentina', 'Italy', 'AR', 'IT', 'Center Court'],
  ['men', 'Spain', 'Portugal', 'ES', 'PT', 'Grand Stand 1'],
].map(([category, home, away, homeCountry, awayCountry, court]) => ({
  id: `2026-11-06-${category}-${cupTeamKey(home)}-${cupTeamKey(away)}`,
  category: category as 'men' | 'women', home, away, homeCountry, awayCountry,
  group: null, videoId: '', court, round: 'semifinals',
  scheduledAt: category === 'women' ? '2026-11-06T11:00:00Z' : '2026-11-06T15:00:00Z',
  notBefore: category === 'men', scheduleSource: CUP_SCHEDULE_SOURCE,
}))

function key(tie: CupTie) {
  const time = tie.scheduledAt ?? tie.liveObservedAt
  if (!time || !Number.isFinite(Date.parse(time))) return null
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Qatar'}).format(new Date(time))
  return `${day}:${tie.category}:${[tie.home,tie.away].map(cupTeamKey).sort().join('|')}`
}

/** Attach broadcasts without replacing official times or making scheduled ties live. */
export function withCupSchedule(streams: CupTie[]): CupTie[] {
  const rows = CUP_SEMIFINALS.map(tie => ({...tie}))
  for (const stream of streams) {
    const index = rows.findIndex(tie => key(tie) === key(stream))
    if (index < 0) rows.push(stream)
    else rows[index] = {...rows[index], videoId:stream.videoId, streams:stream.streams,
      ...(stream.liveObservedAt ? {liveObservedAt:stream.liveObservedAt} : {})}
  }
  return rows
}
