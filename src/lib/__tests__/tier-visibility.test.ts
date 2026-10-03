import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchMatchesHiddenTiers,
  tierExclusionFilter,
  __resetTierVisibilityCache,
} from '../tier-visibility'

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = []
  const builder: any = {
    select: (cols: string) => { calls.push(['select', cols]); return builder },
    eq: (col: string, val: unknown) => {
      calls.push(['eq', col, val])
      return Promise.resolve(result)
    },
  }
  const client: any = {
    from: (table: string) => { calls.push(['from', table]); return builder },
  }
  return { client, calls }
}

describe('tierExclusionFilter', () => {
  it('returns null when nothing is hidden', () => {
    expect(tierExclusionFilter([])).toBeNull()
  })

  it('keeps null levels and excludes the hidden ones', () => {
    expect(tierExclusionFilter(['fip_promises', 'fip_beyond'])).toBe(
      'level.is.null,level.not.in.(fip_promises,fip_beyond)',
    )
  })
})

describe('fetchMatchesHiddenTiers', () => {
  beforeEach(() => __resetTierVisibilityCache())

  it('returns levels with show_on_matches = false', async () => {
    const { client, calls } = fakeClient({
      data: [{ level: 'fip_promises' }, { level: 'fip_beyond' }],
      error: null,
    })
    expect(await fetchMatchesHiddenTiers(client)).toEqual(['fip_promises', 'fip_beyond'])
    expect(calls).toContainEqual(['from', 'tier_visibility'])
    expect(calls).toContainEqual(['eq', 'show_on_matches', false])
  })

  it('serves from cache within the TTL', async () => {
    const { client, calls } = fakeClient({ data: [{ level: 'fip_beyond' }], error: null })
    await fetchMatchesHiddenTiers(client, 1_000)
    await fetchMatchesHiddenTiers(client, 30_000)
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(1)
  })

  it('refetches after the TTL', async () => {
    const { client, calls } = fakeClient({ data: [], error: null })
    await fetchMatchesHiddenTiers(client, 1_000)
    await fetchMatchesHiddenTiers(client, 62_000)
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(2)
  })

  it('fails open on query error and does not cache the failure', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, calls } = fakeClient({ data: null, error: { message: 'relation does not exist' } })
    expect(await fetchMatchesHiddenTiers(client, 1_000)).toEqual([])
    await fetchMatchesHiddenTiers(client, 2_000)
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(2)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
