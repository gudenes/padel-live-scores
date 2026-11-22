import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('release campaign', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals() })
  it('only targets browsing pages and expires fifteen days after launch', async () => {
    const { releaseEligible, RELEASE_END } = await import('./release-state')
    for (const path of ['/home', '/matches', '/tournaments', '/rankings', '/following']) expect(releaseEligible(path, RELEASE_END - 1)).toBe(true)
    for (const path of ['/welcome', '/profile', '/tournaments/123', '/match/123', '/invite-play', '/privacy']) expect(releaseEligible(path, RELEASE_END - 1)).toBe(false)
    expect(releaseEligible('/home', RELEASE_END)).toBe(false)
    expect(releaseEligible('/home', Date.parse('2026-11-21T23:59:59Z'))).toBe(false)
    expect(releaseEligible('/home', Date.parse('2026-11-23T12:00:00Z'))).toBe(true)
    expect(releaseEligible('/home', Date.parse('2026-12-08T12:00:00Z'))).toBe(false)
  })
  it('shows the revised campaign after the previous one, then persists it across reloads', async () => {
    const data = new Map<string, string>([['pn_release_live_race_match_points_2026_11', 'seen']])
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) })
    const state = await import('./release-state')
    expect(state.hasSeenRelease()).toBe(false)
    state.markReleaseSeen()
    expect(data.get(state.RELEASE_KEY)).toBe('seen')
    vi.resetModules()
    expect((await import('./release-state')).hasSeenRelease()).toBe(true)
  })
  it('does not repeatedly show when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } })
    const state = await import('./release-state')
    expect(state.hasSeenRelease()).toBe(false)
    state.markReleaseSeen()
    expect(state.hasSeenRelease()).toBe(true)
  })
})
