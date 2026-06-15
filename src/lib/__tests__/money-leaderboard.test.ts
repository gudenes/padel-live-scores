import { describe, it, expect } from 'vitest'
import { toRankedMoneyRows, type MoneyLeaderboardRpcRow } from '../money-leaderboard'

const row = (id: string, total: number, events = 1): MoneyLeaderboardRpcRow => ({
  player_id: id, name: id, display_name: null, country: 'ES',
  avatar_url: null, total_eur: total, event_count: events,
})

describe('toRankedMoneyRows', () => {
  it('assigns sequential ranks for distinct totals', () => {
    const out = toRankedMoneyRows([row('a', 300), row('b', 200), row('c', 100)])
    expect(out.map(r => r.rank)).toEqual([1, 2, 3])
  })

  it('gives equal totals the same (dense) rank, and the next distinct total skips', () => {
    const out = toRankedMoneyRows([row('a', 500), row('b', 500), row('c', 300)])
    expect(out.map(r => r.rank)).toEqual([1, 1, 3])
  })

  it('preserves the RPC ordering and carries through fields', () => {
    const out = toRankedMoneyRows([row('a', 300, 12), row('b', 100, 4)])
    expect(out[0].player_id).toBe('a')
    expect(out[0].event_count).toBe(12)
    expect(out[1].rank).toBe(2)
  })

  it('returns [] for empty input', () => {
    expect(toRankedMoneyRows([])).toEqual([])
  })
})
