import { describe, it, expect } from 'vitest'
import {
  KNOWN_CATEGORIES,
  CATEGORY_DEFAULTS,
  isKnownCategory,
  resolvePrefs,
  resolveAllPrefs,
  categoryFilter,
} from '../notification-categories'

describe('notification-categories', () => {
  describe('KNOWN_CATEGORIES', () => {
    it('contains exactly the 5 supported categories', () => {
      expect(new Set(KNOWN_CATEGORIES)).toEqual(
        new Set(['match_live_follow', 'match_live_bookmark', 'match_finished', 'ranking_updated', 'marketing']),
      )
    })

    it('does NOT contain the deprecated categories', () => {
      expect(KNOWN_CATEGORIES).not.toContain('match_upcoming')
      expect(KNOWN_CATEGORIES).not.toContain('badge_earned')
      expect(KNOWN_CATEGORIES).not.toContain('streak_milestone')
    })
  })

  describe('CATEGORY_DEFAULTS', () => {
    it('every active category defaults to push: true', () => {
      expect(CATEGORY_DEFAULTS.match_live_follow.push).toBe(true)
      expect(CATEGORY_DEFAULTS.match_live_bookmark.push).toBe(true)
      expect(CATEGORY_DEFAULTS.match_finished.push).toBe(true)
      expect(CATEGORY_DEFAULTS.ranking_updated.push).toBe(true)
    })

    it('marketing defaults to push: true (opt-out per 2026-05-27 decision)', () => {
      expect(CATEGORY_DEFAULTS.marketing.push).toBe(true)
    })

    it('ChannelPrefs has only a push field — no inApp', () => {
      for (const key of KNOWN_CATEGORIES) {
        expect(Object.keys(CATEGORY_DEFAULTS[key])).toEqual(['push'])
      }
    })
  })

  describe('isKnownCategory', () => {
    it('returns true for current categories', () => {
      expect(isKnownCategory('match_live_follow')).toBe(true)
      expect(isKnownCategory('ranking_updated')).toBe(true)
    })

    it('returns false for deprecated categories', () => {
      expect(isKnownCategory('badge_earned')).toBe(false)
      expect(isKnownCategory('streak_milestone')).toBe(false)
      expect(isKnownCategory('match_upcoming')).toBe(false)
    })

    it('returns false for non-strings', () => {
      expect(isKnownCategory(null)).toBe(false)
      expect(isKnownCategory(42)).toBe(false)
    })
  })

  describe('resolvePrefs', () => {
    it('falls back to defaults when stored is null', () => {
      expect(resolvePrefs(null, 'match_live_follow')).toEqual({ push: true })
    })

    it('returns stored override when present', () => {
      const stored = { match_live_follow: { push: false } }
      expect(resolvePrefs(stored, 'match_live_follow')).toEqual({ push: false })
    })

    it('ignores orphan inApp keys from old stored prefs', () => {
      const stored = { match_finished: { push: false, inApp: true } as unknown as { push: boolean } }
      expect(resolvePrefs(stored, 'match_finished')).toEqual({ push: false })
    })

    it('falls back when stored has a category with no push key', () => {
      const stored = { match_finished: {} as { push: boolean } }
      expect(resolvePrefs(stored, 'match_finished')).toEqual({ push: true })
    })
  })

  describe('resolveAllPrefs', () => {
    it('returns one entry per KNOWN_CATEGORIES, no more', () => {
      const out = resolveAllPrefs(null)
      expect(Object.keys(out).sort()).toEqual([...KNOWN_CATEGORIES].sort())
    })
  })

  describe('categoryFilter', () => {
    it('returns null for "all"', () => {
      expect(categoryFilter('all')).toBeNull()
    })

    it('returns the 3 match categories for "matches"', () => {
      expect(new Set(categoryFilter('matches'))).toEqual(
        new Set(['match_live_follow', 'match_live_bookmark', 'match_finished']),
      )
    })

    it('returns the 2 update categories for "updates"', () => {
      expect(new Set(categoryFilter('updates'))).toEqual(
        new Set(['ranking_updated', 'marketing']),
      )
    })

    it('returns empty array for unknown filter values (including the old "badges")', () => {
      expect(categoryFilter('badges')).toEqual([])
      expect(categoryFilter('foo')).toEqual([])
    })
  })
})
