import { describe, it, expect, beforeEach } from 'vitest'
import {
  shouldShowNudge,
  recordDismissal,
  type NudgeContext,
  type NudgeCategory,
} from '../useNotificationNudge'

// Storage mock — vitest's node env has no localStorage by default
class MemStorage {
  store = new Map<string, string>()
  length = 0
  getItem(k: string) { return this.store.get(k) ?? null }
  setItem(k: string, v: string) { this.store.set(k, v) }
  removeItem(k: string) { this.store.delete(k) }
  clear() { this.store.clear() }
  key() { return null }
}

describe('shouldShowNudge', () => {
  let storage: MemStorage

  beforeEach(() => {
    storage = new MemStorage()
  })

  it('returns null when everything is already configured (OS granted + master on + pref on)', () => {
    const ctx: NudgeContext = {
      osPermission: 'granted',
      pushEnabled: true,
      categoryPushPref: true,
      now: new Date('2026-05-27T12:00:00Z').getTime(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBeNull()
  })

  it('returns "os-blocked" when OS denied, regardless of master / pref', () => {
    const ctx: NudgeContext = {
      osPermission: 'denied',
      pushEnabled: true,
      categoryPushPref: true,
      now: Date.now(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('os-blocked')
  })

  it('returns "master-off" when OS granted but master push is off', () => {
    const ctx: NudgeContext = {
      osPermission: 'granted',
      pushEnabled: false,
      categoryPushPref: true,
      now: Date.now(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('master-off')
  })

  it('returns "pref-off" when OS granted + master on but pref disabled', () => {
    const ctx: NudgeContext = {
      osPermission: 'granted',
      pushEnabled: true,
      categoryPushPref: false,
      now: Date.now(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('pref-off')
  })

  it('prioritizes os-blocked over master-off and pref-off (all broken)', () => {
    const ctx: NudgeContext = {
      osPermission: 'denied',
      pushEnabled: false,
      categoryPushPref: false,
      now: Date.now(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('os-blocked')
  })

  it('prioritizes master-off over pref-off when OS is granted', () => {
    const ctx: NudgeContext = {
      osPermission: 'granted',
      pushEnabled: false,
      categoryPushPref: false,
      now: Date.now(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('master-off')
  })

  it('returns null when category was dismissed within last 7 days', () => {
    const now = new Date('2026-05-27T12:00:00Z').getTime()
    const fourDaysAgo = now - 4 * 86400_000
    storage.setItem('pn:nudge-dismissed:match_live_bookmark', String(fourDaysAgo))
    const ctx: NudgeContext = {
      osPermission: 'denied',
      pushEnabled: false,
      categoryPushPref: false,
      now,
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBeNull()
  })

  it('returns the nudge again after 7 days have passed since dismissal', () => {
    const now = new Date('2026-05-27T12:00:00Z').getTime()
    const eightDaysAgo = now - 8 * 86400_000
    storage.setItem('pn:nudge-dismissed:match_live_bookmark', String(eightDaysAgo))
    const ctx: NudgeContext = {
      osPermission: 'denied',
      pushEnabled: false,
      categoryPushPref: false,
      now,
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('os-blocked')
  })

  it('dismissal is per-category — dismissing bookmark does not silence follow', () => {
    const now = Date.now()
    storage.setItem('pn:nudge-dismissed:match_live_bookmark', String(now))
    const ctx: NudgeContext = {
      osPermission: 'denied',
      pushEnabled: false,
      categoryPushPref: false,
      now,
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBeNull()
    expect(shouldShowNudge('match_live_follow', ctx)).toBe('os-blocked')
  })
})

describe('recordDismissal', () => {
  it('writes the current timestamp to the per-category key', () => {
    const storage = new MemStorage()
    const now = 1234567890
    recordDismissal('match_live_bookmark' as NudgeCategory, now, storage as unknown as Storage)
    expect(storage.getItem('pn:nudge-dismissed:match_live_bookmark')).toBe('1234567890')
  })
})
