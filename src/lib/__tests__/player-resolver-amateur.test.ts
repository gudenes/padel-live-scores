// The resolver must never consider an amateur row as a match candidate.
// A club player sharing a name with a FIP professional is the failure
// mode this guards against.
import { describe, it, expect, vi } from 'vitest'
import { PlayerResolver } from '../player-resolver'

/** Records the filters applied to the players cache-loading select. */
function makeSupabaseSpy() {
  const applied: Array<{ method: string; args: unknown[] }> = []
  const builder: Record<string, unknown> = {}
  const chain = (method: string) => (...args: unknown[]) => {
    applied.push({ method, args })
    return builder
  }
  builder.select = chain('select')
  builder.neq = chain('neq')
  builder.eq = chain('eq')
  builder.range = (...args: unknown[]) => {
    applied.push({ method: 'range', args })
    return Promise.resolve({ data: [], error: null })
  }
  const supabase = { from: vi.fn(() => builder) }
  return { supabase, applied }
}

describe('PlayerResolver amateur isolation', () => {
  it('excludes amateur rows when loading the resolution cache', async () => {
    const { supabase, applied } = makeSupabaseSpy()
    const resolver = new PlayerResolver(supabase as never)

    await resolver.load()

    const neqCalls = applied.filter(a => a.method === 'neq')
    expect(neqCalls).toHaveLength(1)
    expect(neqCalls[0].args).toEqual(['tier', 'amateur'])
  })
})
