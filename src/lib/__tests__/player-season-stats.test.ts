import { describe, it, expect, vi } from 'vitest'
import { calculateSeasonStats, fetchPlayerSeasonStats, type SeasonResult } from '../player-season-stats'

const row = (id: string, overrides: Partial<SeasonResult> = {}): SeasonResult => ({
  id, status: 'finished', winner_pair: 1, scheduled_at: '2026-05-01T10:00:00Z', started_at: null,
  tournament: null, pair1_player1_id: 'a', pair1_player2_id: 'b', pair2_player1_id: 'c', pair2_player2_id: 'd', ...overrides,
})
describe('season stats', () => {
  it('counts both partners, rounds percentages, and preserves zero versus no results', () => {
    const stats = calculateSeasonStats([row('1'), row('2'), row('3', { winner_pair: 2, pair2_player2_id: 'e' })], ['a','b','c','d','missing'], 2026)
    expect(stats.a).toEqual({ wins: 2, matches: 3, winRate: 67 })
    expect(stats.b).toEqual(stats.a)
    expect(stats.c).toEqual({ wins: 1, matches: 3, winRate: 33 })
    expect(stats.d).toEqual({ wins: 0, matches: 2, winRate: 0 })
    expect(stats.missing).toEqual({ wins: 0, matches: 0, winRate: null })
  })
  it('uses the season boundary, fallback dates, and confirmed played results only', () => {
    const rows = [row('old', { scheduled_at: '2025-12-31T23:59:59Z' }), row('new', { scheduled_at: '2027-01-01T00:00:00Z' }),
      row('start', { scheduled_at: null, started_at: '2026-01-01T00:00:00Z' }),
      row('tournament', { scheduled_at: null, tournament: { starts_at: '2026-12-31' } }),
      row('undated', { scheduled_at: null }), row('retirement', { status: 'retired' }),
      ...['walkover','cancelled','live','scheduled'].map(status => row(status, { status })), row('unknown', { winner_pair: null }), row('bad', { winner_pair: 3 })]
    expect(calculateSeasonStats(rows, ['a'], 2026).a.matches).toBe(3)
  })
  it('deduplicates rows', () => {
    expect(calculateSeasonStats([row('same'),row('same')], ['a'], 2026).a.matches).toBe(1)
  })
  it('reads only materialized rows and surfaces errors rather than reporting zero', async () => {
    const query: any = {}
    for (const method of ['select','eq','in']) query[method] = vi.fn(() => query)
    const id = '00000000-0000-0000-0000-000000000001'
    query.abortSignal = vi.fn().mockResolvedValueOnce({ data: [{ player_id:id,wins:3,matches:4,win_rate:75 }], error: null })
    const client: any = { from: vi.fn(() => query) }
    const result = await fetchPlayerSeasonStats(client, [id], 2026, new AbortController().signal)
    expect(client.from).toHaveBeenCalledWith('player_season_stats')
    expect(query.eq).toHaveBeenCalledWith('season',2026)
    expect(result[id]).toEqual({wins:3,matches:4,winRate:75})
    query.abortSignal.mockResolvedValueOnce({ data: null, error: new Error('offline') })
    await expect(fetchPlayerSeasonStats(client, [id], 2026, new AbortController().signal)).rejects.toThrow('offline')
  })
})
