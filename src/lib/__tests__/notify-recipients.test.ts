// src/lib/__tests__/notify-recipients.test.ts
import { describe, it, expect } from 'vitest'
import { resolveEntityFollowers } from '@/lib/notify-recipients'

// Fake of the supabase query-builder chain used by the resolver.
//
// The resolver issues several sequential queries, and for `match` the same
// table (user_bookmarks / anon_bookmarks) is queried twice with different
// filters. So we key responses by `${table}:${bookmark_type}` when a
// bookmark_type filter is present, else by `${table}`. `matches` returns a
// single row via `.single()`.
type Row = Record<string, unknown>
type Resp = { data: unknown; error: unknown }

function fakeSupabase(rowsByKey: Record<string, Row[] | Row | { error: unknown }>) {
  const lastFilters: Record<string, unknown> = {}
  // Records every filter call so tests can assert the resolver picked `.eq`
  // (single id) vs `.in` (batch) for a given column.
  const calls: Array<{ m: 'eq' | 'in'; col: string; val: unknown }> = []
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {}
    let isSingle = false
    const resolveResp = (): Resp => {
      Object.assign(lastFilters, filters)
      const bt = filters.bookmark_type
      const keyed = bt != null ? `${table}:${bt}` : table
      const entry = rowsByKey[keyed] ?? rowsByKey[table]
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'error' in entry) {
        return { data: null, error: (entry as { error: unknown }).error }
      }
      if (isSingle) {
        const row = Array.isArray(entry) ? (entry[0] ?? null) : (entry ?? null)
        return { data: row, error: null }
      }
      return { data: (entry as Row[]) ?? [], error: null }
    }
    const chain = {
      select() { return chain },
      eq(col: string, val: unknown) { filters[col] = val; calls.push({ m: 'eq', col, val }); return chain },
      in(col: string, val: unknown) { filters[col] = val; calls.push({ m: 'in', col, val }); return chain },
      single() { isSingle = true; return chain },
      then(resolve: (r: Resp) => void) { resolve(resolveResp()) },
    }
    return chain
  }
  return { from: builder, _filters: lastFilters, _calls: calls } as never
}

const filtersOf = (s: unknown) => (s as { _filters: Record<string, unknown> })._filters
const callsOf = (s: unknown) => (s as { _calls: Array<{ m: 'eq' | 'in'; col: string; val: unknown }> })._calls

describe('resolveEntityFollowers', () => {
  it('queries user_bookmarks by bookmark_type+target_id for a tournament', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }, { user_id: 'u2' }] })
    const res = await resolveEntityFollowers(supa, 'tournament', 't-1')
    expect(res.userIds.sort()).toEqual(['u1', 'u2'])
    expect(filtersOf(supa)).toMatchObject({ bookmark_type: 'tournament', target_id: 't-1' })
  })

  it('tournament resolves no anon subs (no tournament anon_bookmarks type)', async () => {
    const supa = fakeSupabase({
      user_bookmarks: [{ user_id: 'u1' }],
      // even if anon rows existed, tournament must never read them
      anon_push_subscriptions: [{ id: 's1', endpoint: 'e', p256dh_key: 'p', auth_key: 'a' }],
    })
    const res = await resolveEntityFollowers(supa, 'tournament', 't-1')
    expect(res.userIds).toEqual(['u1'])
    expect(res.anonSubs).toEqual([])
  })

  it('dedupes repeated user_ids', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }, { user_id: 'u1' }] })
    const res = await resolveEntityFollowers(supa, 'player', 'p-1')
    expect(res.userIds).toEqual(['u1'])
  })

  it('returns empty for no followers', async () => {
    const supa = fakeSupabase({})
    const res = await resolveEntityFollowers(supa, 'tournament', 't-x')
    expect(res.userIds).toEqual([])
    expect(res.anonSubs).toEqual([])
  })

  it('player populates anonSubs from anon_bookmarks → device_ids → anon_push_subscriptions', async () => {
    const supa = fakeSupabase({
      user_bookmarks: [{ user_id: 'u1' }],
      anon_bookmarks: [{ device_id: 'd1' }, { device_id: 'd1' }, { device_id: 'd2' }],
      anon_push_subscriptions: [
        { id: 's1', endpoint: 'e1', p256dh_key: 'p1', auth_key: 'a1' },
        { id: 's2', endpoint: 'e2', p256dh_key: 'p2', auth_key: 'a2' },
        // duplicate id must be deduped
        { id: 's2', endpoint: 'e2', p256dh_key: 'p2', auth_key: 'a2' },
      ],
    })
    const res = await resolveEntityFollowers(supa, 'player', 'p-1')
    expect(res.userIds).toEqual(['u1'])
    expect(res.anonSubs.map((s) => s.id).sort()).toEqual(['s1', 's2'])
    expect(res.anonSubs[0]).toMatchObject({ endpoint: expect.any(String), p256dh_key: expect.any(String), auth_key: expect.any(String) })
  })

  it('match unions match-bookmarks + player-follows across authed and anon', async () => {
    const supa = fakeSupabase({
      matches: {
        pair1_player1_id: 'pa',
        pair1_player2_id: 'pb',
        pair2_player1_id: 'pc',
        pair2_player2_id: null,
      },
      // authed: match-bookmark u1, player-follows u2 (+ overlap u1)
      'user_bookmarks:match': [{ user_id: 'u1' }],
      'user_bookmarks:player': [{ user_id: 'u2' }, { user_id: 'u1' }],
      // anon: match-bookmark d1, player-bookmark d2
      'anon_bookmarks:match': [{ device_id: 'd1' }],
      'anon_bookmarks:player': [{ device_id: 'd2' }, { device_id: 'd1' }],
      anon_push_subscriptions: [
        { id: 's1', endpoint: 'e1', p256dh_key: 'p1', auth_key: 'a1' },
        { id: 's2', endpoint: 'e2', p256dh_key: 'p2', auth_key: 'a2' },
      ],
    })
    const res = await resolveEntityFollowers(supa, 'match', 'm-1')
    expect(res.userIds.sort()).toEqual(['u1', 'u2'])
    expect(res.anonSubs.map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })

  it('match with no players still resolves match-scoped bookmarks', async () => {
    const supa = fakeSupabase({
      matches: {
        pair1_player1_id: null,
        pair1_player2_id: null,
        pair2_player1_id: null,
        pair2_player2_id: null,
      },
      'user_bookmarks:match': [{ user_id: 'u1' }],
      'anon_bookmarks:match': [{ device_id: 'd1' }],
      anon_push_subscriptions: [{ id: 's1', endpoint: 'e1', p256dh_key: 'p1', auth_key: 'a1' }],
    })
    const res = await resolveEntityFollowers(supa, 'match', 'm-1')
    expect(res.userIds).toEqual(['u1'])
    expect(res.anonSubs.map((s) => s.id)).toEqual(['s1'])
  })

  it('fails soft to empty when a query errors', async () => {
    const supa = fakeSupabase({ user_bookmarks: { error: new Error('boom') } })
    const res = await resolveEntityFollowers(supa, 'player', 'p-1')
    expect(res).toEqual({ userIds: [], anonSubs: [] })
  })

  it('batch (array entityId) resolves the union of player followers via .in, deduped', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u1' }] })
    const res = await resolveEntityFollowers(supa, 'player', ['p-1', 'p-2', 'p-3'])
    expect(res.userIds.sort()).toEqual(['u1', 'u2'])
    const calls = callsOf(supa)
    // target_id must be queried with `.in` (not `.eq`) when an array is passed.
    expect(calls).toContainEqual({ m: 'in', col: 'target_id', val: ['p-1', 'p-2', 'p-3'] })
    expect(calls.some((c) => c.m === 'eq' && c.col === 'target_id')).toBe(false)
  })

  it('single (string entityId) still queries target_id with .eq', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }] })
    await resolveEntityFollowers(supa, 'player', 'p-1')
    const calls = callsOf(supa)
    expect(calls).toContainEqual({ m: 'eq', col: 'target_id', val: 'p-1' })
    expect(calls.some((c) => c.m === 'in' && c.col === 'target_id')).toBe(false)
  })

  it('empty array resolves to no followers without querying bookmarks', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }] })
    const res = await resolveEntityFollowers(supa, 'player', [])
    expect(res).toEqual({ userIds: [], anonSubs: [] })
    expect(callsOf(supa).some((c) => c.col === 'target_id')).toBe(false)
  })

  it('rejects unsupported entity types at the type level (runtime guard returns empty)', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }] })
    // @ts-expect-error 'news_source' is not a supported EntityType
    const res = await resolveEntityFollowers(supa, 'news_source', 'x')
    expect(res.userIds).toEqual([])
    expect(res.anonSubs).toEqual([])
  })
})
