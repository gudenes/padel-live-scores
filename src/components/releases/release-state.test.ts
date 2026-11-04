import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('release campaign', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals() })
  it('only targets browsing pages and stops at the end of November', async () => {
    const { releaseEligible, RELEASE_END } = await import('./release-state')
    for (const path of ['/home', '/matches', '/tournaments', '/rankings', '/following']) expect(releaseEligible(path, RELEASE_END - 1)).toBe(true)
    for (const path of ['/welcome', '/profile', '/tournaments/123', '/match/123', '/invite-play', '/privacy']) expect(releaseEligible(path, RELEASE_END - 1)).toBe(false)
    expect(releaseEligible('/home', RELEASE_END)).toBe(false)
  })
  it('persists an impression and recognizes it after remount/reload', async () => {
    const data = new Map<string, string>()
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
