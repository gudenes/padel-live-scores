import { describe, it, expect, vi, beforeEach } from 'vitest'

const hidden = vi.hoisted(() => ({ value: [] as string[] }))
vi.mock('../tier-visibility', async (orig) => {
  const actual = await orig<typeof import('../tier-visibility')>()
  return { ...actual, fetchMatchesHiddenTiers: async () => hidden.value }
})

import { fetchMatchesDay } from '../fetch-matches-day'

function fakeClient() {
  const calls: Array<[string, ...unknown[]]> = []
  const builder: any = {
    select: (cols: string) => { calls.push(['select', cols]); return builder },
    or: (f: string, opts?: unknown) => { calls.push(['or', f, opts]); return builder },
    order: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
  }
  return { client: { from: () => builder } as any, calls }
}

describe('fetchMatchesDay tier visibility', () => {
  beforeEach(() => { hidden.value = [] })

  it('inner-joins tournaments and excludes hidden levels', async () => {
    hidden.value = ['fip_promises', 'fip_beyond']
    const { client, calls } = fakeClient()
    await fetchMatchesDay(client, '2026-10-03', 'UTC')

    const select = calls.find((c) => c[0] === 'select')![1] as string
    expect(select).toContain('tournament:tournaments!inner(')
    expect(calls).toContainEqual([
      'or',
      'level.is.null,level.not.in.(fip_promises,fip_beyond)',
      { referencedTable: 'tournament' },
    ])
  })

  it('leaves the query untouched when nothing is hidden', async () => {
    const { client, calls } = fakeClient()
    await fetchMatchesDay(client, '2026-10-03', 'UTC')

    const select = calls.find((c) => c[0] === 'select')![1] as string
    expect(select).toContain('tournament:tournaments(')
    expect(select).not.toContain('!inner')
    expect(calls.filter((c) => c[0] === 'or')).toHaveLength(1)
  })
})
