import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOfficialLeaderboard } from '../official-leaderboard'

function client(results: unknown[]) {
  const calls: Array<{ table: string; filters: unknown[][] }> = []
  const from = vi.fn((table: string) => {
    const call = { table, filters: [] as unknown[][] }
    calls.push(call)
    const result = results.shift()
    const query: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle']) {
      query[method] = (...args: unknown[]) => { call.filters.push([method, ...args]); return query }
    }
    return query
  })
  return { db: { from } as unknown as SupabaseClient, calls }
}
const ok = (data: unknown) => ({ data, error: null })

describe('official leaderboard', () => {
  it('uses snapshot membership and scores, preserves ties and respects public profile visibility', async () => {
    const snapshots = client([
      ok({ year: 2026, week: 43, ranking_date: '2026-10-19' }),
      ok([
        { player_id: 'a', ranking: 140, points: 411, ranking_move: 5 },
        { player_id: 'b', ranking: 140, points: 411, ranking_move: -4 },
        { player_id: 'hidden', ranking: 142, points: 407, ranking_move: 0 },
      ]),
      ok([{ player_id: 'a', points: 396 }]),
    ])
    const profiles = client([ok([{ id: 'a', name: 'Gustavo', ranking: 999, points: 0 }, { id: 'b', name: 'Pablo' }])])
    const result = await loadOfficialLeaderboard(snapshots.db, profiles.db, 'men')
    expect(result.players).toEqual([
      expect.objectContaining({ id: 'a', ranking: 140, points: 411, points_move: 15 }),
      expect.objectContaining({ id: 'b', ranking: 140, points: 411, points_move: null }),
    ])
    expect(result.rankingDate).toBe('2026-10-19')
    expect(profiles.calls[0].filters).toContainEqual(['in', 'id', ['a', 'b', 'hidden']])
    expect(profiles.calls[0].filters).toContainEqual(['eq', 'hidden', false])
    expect(snapshots.calls[1].filters).toContainEqual(['eq', 'gender', 'men'])
    expect(snapshots.calls[2].filters).toContainEqual(['eq', 'week', 42])
  })

  it('does not fall back to legacy player ranks when no publication exists', async () => {
    const profiles = client([])
    expect(await loadOfficialLeaderboard(client([ok(null)]).db, profiles.db, 'women'))
      .toEqual({ players: [], rankingDate: null })
    expect(profiles.calls).toHaveLength(0)
  })

  it('fails closed on a snapshot read error', async () => {
    const error = { message: 'database unavailable' }
    await expect(loadOfficialLeaderboard(client([{ data: null, error }]).db, client([]).db, 'men'))
      .rejects.toEqual(error)
  })

  it('chunks large profile requests without dropping or reordering rankings', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ player_id: `${i}`, ranking: i + 1, points: 0, ranking_move: 0 }))
    const snapshots = client([ok({ year: 2026, week: 1, ranking_date: '2025-12-29' }), ok(rows), ok([])])
    const profiles = client([ok(rows.slice(0, 100).reverse().map(row => ({ id: row.player_id }))), ok([{ id: '100' }])])
    const result = await loadOfficialLeaderboard(snapshots.db, profiles.db, 'women')
    expect(result.players).toHaveLength(101)
    expect(result.players[100].ranking).toBe(101)
    expect(profiles.calls).toHaveLength(2)
    expect(snapshots.calls[2].filters).toContainEqual(['eq', 'year', 2025])
    expect(snapshots.calls[2].filters).toContainEqual(['eq', 'week', 52])
  })
})
