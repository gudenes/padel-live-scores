import { describe, it, expect } from 'vitest'
import { getPlayerRecentMatches } from '../../src/lib/data/player-recent-matches'
import { searchPlayer } from '../../src/lib/data/search-player'

const hasDb = !!process.env.DATABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('getPlayerRecentMatches', () => {
  it('returns recent matches for a top-50 player', async () => {
    const players = await searchPlayer('Tapia', { limit: 1 })
    expect(players.length).toBeGreaterThan(0)
    const matches = await getPlayerRecentMatches(players[0].id, { limit: 5 })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.length).toBeLessThanOrEqual(5)
    const m = matches[0]
    expect(m).toHaveProperty('id')
    expect(m).toHaveProperty('played_at')  // Field in MatchSummary type
    expect(m).toHaveProperty('pair1')
    expect(m).toHaveProperty('pair2')
    expect(Array.isArray(m.set_scores)).toBe(true)
  })

  it('returns empty array for unknown id', async () => {
    const matches = await getPlayerRecentMatches('00000000-0000-0000-0000-000000000000', { limit: 5 })
    expect(matches).toEqual([])
  })

  it('orders by played_at descending', async () => {
    const players = await searchPlayer('Tapia', { limit: 1 })
    const matches = await getPlayerRecentMatches(players[0].id, { limit: 10 })
    if (matches.length < 2) return
    for (let i = 1; i < matches.length; i++) {
      const prev = matches[i - 1].played_at ? new Date(matches[i - 1].played_at!).getTime() : 0
      const curr = matches[i].played_at ? new Date(matches[i].played_at!).getTime() : 0
      expect(prev).toBeGreaterThanOrEqual(curr)
    }
  })
})
