import { describe, it, expect, vi } from 'vitest'
import { isMatchWebtugaSourced } from '../webtuga-source'

/** Minimal supabase stub: from().select().eq().eq().eq().maybeSingle() */
function fakeSupabase(row: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  }
  return { from: vi.fn(() => chain) } as any
}

describe('isMatchWebtugaSourced', () => {
  it('returns true when a webtuga external-id row exists', async () => {
    const out = await isMatchWebtugaSourced(fakeSupabase({ entity_id: 'm1' }), 'm1')
    expect(out).toBe(true)
  })

  it('returns false when there is no webtuga row', async () => {
    const out = await isMatchWebtugaSourced(fakeSupabase(null), 'm1')
    expect(out).toBe(false)
  })

  it('returns false (never throws) on a query error', async () => {
    const supabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
        }),
      }),
    }
    const out = await isMatchWebtugaSourced(supabase, 'm1')
    expect(out).toBe(false)
  })
})
