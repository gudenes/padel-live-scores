/**
 * notification-categories.test.ts
 *
 * Unit tests for the pure defaults/resolver/filter module.
 * Run with: npx vitest run src/lib/__tests__/notification-categories.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  CATEGORY_DEFAULTS,
  KNOWN_CATEGORIES,
  isKnownCategory,
  resolvePrefs,
  resolveAllPrefs,
  categoryFilter,
} from '../notification-categories'

describe('CATEGORY_DEFAULTS', () => {
  it('contains exactly 7 categories', () => {
    expect(KNOWN_CATEGORIES).toHaveLength(7)
  })

  it('marketing defaults to off for both channels', () => {
    expect(CATEGORY_DEFAULTS.marketing).toEqual({ push: false, inApp: false })
  })

  it('match_live_* defaults to on for both channels', () => {
    expect(CATEGORY_DEFAULTS.match_live_follow).toEqual({ push: true, inApp: true })
    expect(CATEGORY_DEFAULTS.match_live_bookmark).toEqual({ push: true, inApp: true })
  })

  it('match_finished defaults to push on, inApp on (changed 2026-04-23)', () => {
    // Bumped from push:false in 2026-04-23 — see notification-categories.ts.
    // /api/push/notify checks the category-specific flag and now sends a
    // push when a followed match finishes.
    expect(CATEGORY_DEFAULTS.match_finished).toEqual({ push: true, inApp: true })
  })

  it('match_upcoming defaults to push off, inApp on', () => {
    expect(CATEGORY_DEFAULTS.match_upcoming).toEqual({ push: false, inApp: true })
  })
})

describe('isKnownCategory', () => {
  it('returns true for each known category', () => {
    for (const k of KNOWN_CATEGORIES) expect(isKnownCategory(k)).toBe(true)
  })

  it('returns false for unknown strings', () => {
    expect(isKnownCategory('foo')).toBe(false)
    expect(isKnownCategory('')).toBe(false)
  })

  it('returns false for non-strings', () => {
    expect(isKnownCategory(null)).toBe(false)
    expect(isKnownCategory(undefined)).toBe(false)
    expect(isKnownCategory(42)).toBe(false)
  })
})

describe('resolvePrefs', () => {
  it('returns defaults when stored is null', () => {
    expect(resolvePrefs(null, 'match_live_follow')).toEqual({ push: true, inApp: true })
  })

  it('returns defaults when stored is undefined', () => {
    expect(resolvePrefs(undefined, 'marketing')).toEqual({ push: false, inApp: false })
  })

  it('returns defaults when stored is empty', () => {
    expect(resolvePrefs({}, 'match_live_bookmark')).toEqual({ push: true, inApp: true })
  })

  it('returns defaults when the category key is missing', () => {
    expect(resolvePrefs({ marketing: { push: true, inApp: true } }, 'match_finished'))
      .toEqual({ push: true, inApp: true })
  })

  it('uses stored override when both channels set', () => {
    expect(resolvePrefs({ match_live_follow: { push: false, inApp: false } }, 'match_live_follow'))
      .toEqual({ push: false, inApp: false })
  })

  it('merges partial override (push only) with default inApp', () => {
    expect(resolvePrefs({ match_live_follow: { push: false } }, 'match_live_follow'))
      .toEqual({ push: false, inApp: true })
  })

  it('merges partial override (inApp only) with default push', () => {
    expect(resolvePrefs({ badge_earned: { inApp: false } }, 'badge_earned'))
      .toEqual({ push: true, inApp: false })
  })

  it('ignores non-boolean junk in override', () => {
    const junk = { match_live_follow: { push: 'yes' as unknown as boolean } }
    expect(resolvePrefs(junk, 'match_live_follow')).toEqual({ push: true, inApp: true })
  })
})

describe('resolveAllPrefs', () => {
  it('returns all 7 categories', () => {
    const all = resolveAllPrefs(null)
    expect(Object.keys(all)).toHaveLength(7)
    expect(all.match_live_follow).toEqual({ push: true, inApp: true })
    expect(all.marketing).toEqual({ push: false, inApp: false })
  })

  it('applies overrides per category', () => {
    const stored = { marketing: { push: true, inApp: true } }
    const all = resolveAllPrefs(stored)
    expect(all.marketing).toEqual({ push: true, inApp: true })
    expect(all.match_live_follow).toEqual({ push: true, inApp: true })
  })
})

describe('categoryFilter', () => {
  it('returns null for "all" (no filter)', () => {
    expect(categoryFilter('all')).toBeNull()
  })

  it('returns the 4 match categories for "matches"', () => {
    expect(categoryFilter('matches')).toEqual([
      'match_live_follow',
      'match_live_bookmark',
      'match_finished',
      'match_upcoming',
    ])
  })

  it('returns the 2 badge categories for "badges"', () => {
    expect(categoryFilter('badges')).toEqual(['badge_earned', 'streak_milestone'])
  })

  it('returns empty list for unknown filter', () => {
    expect(categoryFilter('zzz')).toEqual([])
  })
})
