import { describe, it, expect, vi } from 'vitest'
import { searchPlayers } from '../player-search'

// Minimal chainable fake of the Supabase client used by searchPlayers.
function makeFake(opts: {
  rpc?: (name: string, args: unknown) => { data: unknown; error: unknown }
  fallbackData?: unknown[]
}) {
  const calls = { rpc: 0, from: 0 }
  const fake = {
    calls,
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc++
      return opts.rpc ? opts.rpc(name, args) : { data: null, error: null }
    }),
    from() {
      calls.from++
      const builder: Record<string, unknown> = {
        select: () => builder,
        or: () => builder,
        order: () => builder,
        limit: async () => ({ data: opts.fallbackData ?? [], error: null }),
      }
      return builder
    },
  }
  return fake
}

const ROW = { id: '1', name: 'Arturo Coello', display_name: null, country: 'ES', ranking: 1, category: 'men', avatar_url: null }

describe('searchPlayers', () => {
  it('returns [] for an empty/whitespace query without hitting the DB', async () => {
    const fake = makeFake({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await searchPlayers(fake as any, '   ', 5)).toEqual([])
    expect(fake.calls.rpc).toBe(0)
    expect(fake.calls.from).toBe(0)
  })

  it('returns RPC rows on success', async () => {
    const fake = makeFake({ rpc: () => ({ data: [ROW], error: null }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await searchPlayers(fake as any, 'cohello', 5)
    expect(rows).toEqual([ROW])
    expect(fake.calls.from).toBe(0) // no fallback
  })

  it('falls back to the ilike query when the RPC errors', async () => {
    const fake = makeFake({ rpc: () => ({ data: null, error: { message: 'boom' } }), fallbackData: [ROW] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await searchPlayers(fake as any, 'coello', 5)
    expect(rows).toEqual([ROW])
    expect(fake.calls.rpc).toBe(1)
    expect(fake.calls.from).toBe(1) // fallback used
  })
})
