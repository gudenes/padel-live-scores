import { describe, expect, it } from 'vitest'
import { matchCupYouTubeStreams, type CupYouTubeRow } from '../world-cup-youtube'
import { dailyCupTies } from '../world-cup-daily'
import { WORLD_CUP, type CupTeam } from '../world-cup'
import type { MatchesDayGroup } from '../fetch-matches-day'

const now = new Date('2026-11-05T11:06:00Z')
const teams: CupTeam[] = ['women', 'men'].flatMap(category => [
  { name: 'Argentina', country: 'ARG', category: category as 'women' | 'men', players: [] },
  { name: 'Portugal', country: 'POR', category: category as 'women' | 'men', players: [] },
])
const row: CupYouTubeRow = { video_id: 'hiu1UcRR98o', title: '[ESP] 🇦🇷 ARGENTINA VS PORTUGAL 🇵🇹 - WOMEN - QUARTER-FINALS 1-8 - FIP WORLD CUP 2026', started_at: '2026-11-05T10:55:26Z', last_seen_at: '2026-11-05T11:05:00Z' }

describe('World Cup YouTube matching', () => {
  it('groups language variants and duplicate observations into one dated tie', () => {
    const english = { ...row, video_id: 'E6Helf0FUDU', title: row.title.replace('[ESP]', '[ENG]') }
    const ties = matchCupYouTubeStreams([row, english, row], teams, now)
    expect(ties).toHaveLength(1)
    expect(ties[0]).toMatchObject({ home: 'Argentina', away: 'Portugal', category: 'women', scheduledAt: new Date(row.started_at!).toISOString(), streams: [{ videoId: row.video_id, language: 'ESP' }, { videoId: english.video_id, language: 'ENG' }] })
    expect(ties[0].liveObservedAt).toBeUndefined()
  })
  it.each([
    { started_at: null }, { last_seen_at: '2026-11-05T10:50:00Z' },
    { title: row.title.replace('2026', '2025') },
    { title: row.title.replace('PORTUGAL', 'UNKNOWN') },
    { title: row.title.replace('WOMEN', 'JUNIORS') },
    { video_id: 'invalid' }, { started_at: '2026-11-06T10:00:00Z' },
  ])('rejects unsafe or stale match: %j', patch => {
    expect(matchCupYouTubeStreams([{ ...row, ...patch }], teams, now)).toEqual([])
  })
  it('keeps yesterday broadcasts off today, even when observed today', () => {
    const ties = matchCupYouTubeStreams([{ ...row, started_at: '2026-11-04T11:00:00Z' }], teams, now)
    expect(dailyCupTies({ ties, teams, groups: [], partial: false, fetchedAt: now.toISOString() }, [], '2026-11-05', 'Europe/Madrid')).toEqual([])
  })
  it('attaches to the correct category and country tie without declaring scheduled matches live', () => {
    const ties = matchCupYouTubeStreams([row], teams, now)
    const match = { id: 'one', category: 'women', scheduled_at: '2026-11-05T11:00:00Z', status: 'scheduled', sets: [], pair1_player1_country: 'POR', pair1_player2_country: 'POR', pair2_player1_country: 'ARG', pair2_player2_country: 'ARG' }
    const groups = [{ tournamentId: WORLD_CUP.tournamentId, matches: [match, { ...match, id: 'men', category: 'men' }] }] as unknown as MatchesDayGroup[]
    const daily = dailyCupTies({ ties, teams, groups: [], partial: false, fetchedAt: now.toISOString() }, groups, '2026-11-05', 'Europe/Madrid')
    expect(daily.find(t => t.category === 'women')).toMatchObject({ videoId: row.video_id, status: 'upcoming' })
    expect(daily.find(t => t.category === 'men')?.videoId).toBeNull()
  })
})
