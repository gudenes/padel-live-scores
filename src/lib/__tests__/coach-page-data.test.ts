import { describe, it, expect } from 'vitest'
import {
  initials, shortPlayerName, splitPlayers, shapeTitles, pickNextMatches, isIndexable, topPlayerNames,
  type CoachPlayer, type FinalRow, type UpcomingRow,
} from '../coach-page-data'

const p = (o: Partial<CoachPlayer> & { id: string }): CoachPlayer => ({
  name: o.id, display_name: null, country: null, category: 'men', ranking: null, points: 0, avatar_url: null, ...o,
})

describe('initials / shortPlayerName', () => {
  it('initials from first and last word', () => {
    expect(initials('Gustavo Pratto')).toBe('GP')
    expect(initials('Martín D’antonio')).toBe('MD')
    expect(initials('Juan')).toBe('J')
  })
  it('short name prefers display_name, else surname', () => {
    expect(shortPlayerName(p({ id: '1', name: 'Agustin Tapia' }))).toBe('Tapia')
    expect(shortPlayerName(p({ id: '2', name: 'Beatriz Caldera Sanchez', display_name: 'Bea Caldera' }))).toBe('Bea Caldera')
  })
})

describe('splitPlayers', () => {
  it('splits by category and sorts by ranking, unranked last', () => {
    const r = splitPlayers([
      p({ id: 'w2', category: 'women', ranking: 14 }),
      p({ id: 'm-unr', category: 'men', ranking: null }),
      p({ id: 'm1', category: 'men', ranking: 1 }),
      p({ id: 'w1', category: 'women', ranking: 11 }),
      p({ id: 'm39', category: 'men', ranking: 39 }),
    ])
    expect(r.men.map((x) => x.id)).toEqual(['m1', 'm39', 'm-unr'])
    expect(r.women.map((x) => x.id)).toEqual(['w1', 'w2'])
  })
})

describe('shapeTitles', () => {
  const coached = new Set(['tapia', 'coello', 'caldera'])
  const row = (o: Partial<FinalRow>): FinalRow => ({
    match_id: 'm', category: 'men', winner_pair: 1,
    pair1: [{ id: 'tapia', name: 'Agustin Tapia', display_name: null }, { id: 'coello', name: 'Arturo Coello', display_name: null }],
    pair2: [{ id: 'x', name: 'X Y', display_name: null }, { id: 'z', name: 'Z W', display_name: null }],
    tournament: { id: 't1', name: 'PARIS MAJOR', level: 'major', starts_at: '2026-09-07T00:00:00Z', ends_at: '2026-09-13T00:00:00Z' },
    ...o,
  })
  it('keeps finals won by a coached player, current year, newest first', () => {
    const r = shapeTitles([
      row({ match_id: 'a' }),
      row({ match_id: 'b', tournament: { id: 't2', name: 'LONDON P1', level: 'p1', starts_at: '2026-08-03T00:00:00Z', ends_at: '2026-08-09T00:00:00Z' } }),
      row({ match_id: 'old', tournament: { id: 't3', name: 'OLD', level: 'p1', starts_at: '2025-08-03T00:00:00Z', ends_at: '2025-08-09T00:00:00Z' } }),
      row({ match_id: 'lost', winner_pair: 2 }),
    ], coached, 2026)
    expect(r.map((t) => t.tournamentName)).toEqual(['PARIS MAJOR', 'LONDON P1'])
    expect(r[0].pair).toBe('Tapia / Coello')
  })
  it('dedupes per tournament + category and drops team-league levels', () => {
    const r = shapeTitles([
      row({ match_id: 'a' }), row({ match_id: 'a2' }),
      row({ match_id: 'ppl', tournament: { id: 't9', name: 'PPL', level: 'ppl', starts_at: '2026-05-01T00:00:00Z', ends_at: '2026-05-02T00:00:00Z' } }),
    ], coached, 2026)
    expect(r).toHaveLength(1)
  })
})

describe('pickNextMatches', () => {
  const now = new Date('2026-10-02T12:00:00Z')
  const m = (id: string, status: string, at: string | null): UpcomingRow => ({
    match_id: id, status, scheduled_at: at, round: 'QF', tournament_name: 'T', pair1: 'A / B', pair2: 'C / D',
  })
  it('live first, then soonest scheduled, drops stale scheduled, max 3', () => {
    const r = pickNextMatches([
      m('later', 'scheduled', '2026-10-03T10:00:00Z'),
      m('stale', 'scheduled', '2026-10-02T06:00:00Z'),
      m('live', 'live', '2026-10-02T09:00:00Z'),
      m('soon', 'scheduled', '2026-10-02T13:00:00Z'),
      m('soon2', 'scheduled', '2026-10-02T14:00:00Z'),
    ], now)
    expect(r.map((x) => x.match_id)).toEqual(['live', 'soon', 'soon2'])
  })
})

describe('isIndexable / topPlayerNames', () => {
  it('noindex when total points are 0', () => {
    expect(isIndexable({ total_points: 0 })).toBe(false)
    expect(isIndexable({ total_points: 12 })).toBe(true)
  })
  it('top two by points with remainder count', () => {
    expect(topPlayerNames([
      p({ id: '1', name: 'A One', points: 5 }), p({ id: '2', name: 'B Two', points: 50 }), p({ id: '3', name: 'C Three', points: 20 }),
    ])).toEqual({ names: ['Two', 'Three'], more: 1 })
  })
})
