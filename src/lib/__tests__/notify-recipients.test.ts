// src/lib/__tests__/notify-recipients.test.ts
import { describe, it, expect } from 'vitest'
import { resolveEntityFollowers } from '@/lib/notify-recipients'

// Minimal fake of the supabase query-builder chain used by the resolver.
function fakeSupabase(rowsByTable: Record<string, unknown[]>) {
  const calls: { table: string; filters: Record<string, unknown> } = { table: '', filters: {} }
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {}
    const chain = {
      select() { return chain },
      eq(col: string, val: unknown) { filters[col] = val; return chain },
      in(col: string, val: unknown) { filters[col] = val; return chain },
      then(resolve: (r: { data: unknown[]; error: null }) => void) {
        calls.table = table; calls.filters = filters
        resolve({ data: rowsByTable[table] ?? [], error: null })
      },
    }
    return chain
  }
  return { from: builder, _calls: calls } as never
}

describe('resolveEntityFollowers', () => {
  it('queries user_bookmarks by bookmark_type+target_id for a tournament', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }, { user_id: 'u2' }] })
    const res = await resolveEntityFollowers(supa, 'tournament', 't-1')
    expect(res.userIds.sort()).toEqual(['u1', 'u2'])
    expect((supa as never as { _calls: { filters: Record<string, unknown> } })._calls.filters).toMatchObject({
      bookmark_type: 'tournament', target_id: 't-1',
    })
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
  })

  it('rejects unsupported entity types at the type level (runtime guard returns empty)', async () => {
    const supa = fakeSupabase({ user_bookmarks: [{ user_id: 'u1' }] })
    // @ts-expect-error 'news_source' is not a supported EntityType
    const res = await resolveEntityFollowers(supa, 'news_source', 'x')
    expect(res.userIds).toEqual([])
  })
})
