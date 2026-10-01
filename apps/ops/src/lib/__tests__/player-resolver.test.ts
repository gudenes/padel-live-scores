import { describe, it, expect } from 'vitest'
import { PlayerResolver } from '../player-resolver'

// Conflation guards ported from src/lib/__tests__/player-resolver.test.ts —
// this module is a separate copy of the root resolver, so it needs its own.

function seededClient(
  players: Array<Record<string, unknown>>,
  aliases: Array<{ entity_id: string; external_id: string }> = [],
) {
  return {
    from: (table: string) => {
      if (table === 'players') {
        const node: Record<string, unknown> = {
          select: () => node,
          eq: () => node,
          neq: () => node,
          range: (start: number) =>
            Promise.resolve({ data: start === 0 ? players : [], error: null }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          single: () => Promise.resolve({ data: null, error: null }),
        }
        return node
      }
      if (table === 'entity_external_ids') {
        const node: Record<string, unknown> = {
          select: () => node,
          eq: () => node,
          upsert: () => Promise.resolve({ error: null }),
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: aliases, error: null }).then(res),
        }
        return node
      }
      throw new Error('unexpected table ' + table)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const MOMO_ROW = {
  id: 'momo', external_id: 'fip-P000011', fip_id: 'P000011',
  name: 'Jeronimo Gonzalez', normalized_name: 'jeronimo gonzalez',
  country: 'ES', category: 'men', ranking: 14, points: 4371,
}
const JP_ROW = {
  id: 'jp', external_id: null, fip_id: 'P201895',
  name: 'Juan Pereiro Gonzalez', normalized_name: 'juan pereiro gonzalez',
  country: 'ES', category: 'men', ranking: null, points: null,
}

describe('PlayerResolver.lookup — conflation guards (Momo González P000011)', () => {
  it('does NOT lenient-fuzzy-match a lone surname to a same-surname player', async () => {
    const resolver = new PlayerResolver(seededClient([MOMO_ROW]))
    const r = await resolver.lookup(
      { name: 'J Gonzalez', country: 'ES', category: 'men' },
      { lenient: true },
    )
    expect(r.found).toBe(false)
  })

  it('prefers an exact canonical match over a poisoned alias', async () => {
    const resolver = new PlayerResolver(
      seededClient([MOMO_ROW, JP_ROW], [{ entity_id: 'momo', external_id: 'Juan Pereiro Gonzalez' }]),
    )
    const r = await resolver.lookup({ name: 'Juan Pereiro Gonzalez', country: 'ES', category: 'men' })
    expect(r.playerId).toBe('jp')
    expect(r.matchType).toBe('exact')
  })
})

describe('PlayerResolver.resolve — conflation guards (Momo González P000011)', () => {
  it('prefers an exact canonical match over a poisoned alias', async () => {
    const resolver = new PlayerResolver(
      seededClient([MOMO_ROW, JP_ROW], [{ entity_id: 'momo', external_id: 'Juan Pereiro Gonzalez' }]),
    )
    const r = await resolver.resolve({ name: 'Juan Pereiro Gonzalez', country: 'ES', category: 'men' })
    expect(r.playerId).toBe('jp')
  })
})
