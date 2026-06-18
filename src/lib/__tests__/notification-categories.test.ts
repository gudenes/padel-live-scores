import { describe, it, expect } from 'vitest'
import {
  KNOWN_CATEGORIES,
  CATEGORY_DEFAULTS,
  isKnownCategory,
  resolvePrefs,
  resolveAllPrefs,
  categoryFilter,
} from '../notification-categories'
import {
  CATEGORY_META,
  KNOWN_CATEGORIES as KNOWN_CATEGORIES_TIER,
  isProCategory,
  categoriesForTier,
  shouldDeliverToRecipient,
  CATEGORY_GROUPS,
} from '@/lib/notification-categories'

describe('notification-categories', () => {
  describe('KNOWN_CATEGORIES', () => {
    it('contains the full notification catalog', () => {
      expect(new Set(KNOWN_CATEGORIES)).toEqual(
        new Set([
          // existing
          'match_live_follow',
          'match_live_bookmark',
          'match_finished',
          'ranking_updated',
          'marketing',
          // new — free
          'player_title_won',
          'player_eliminated',
          'tournament_starting',
          'draw_released',
          'player_entered',
          'weekly_digest',
          // new — pro
          'match_deciding_set',
          'match_upset_live',
          'next_match_drawn',
          'ranking_threshold',
          'projection_outperform',
          'player_path',
          'prematch_prediction',
          'daily_oop',
          'tournament_wrapup',
        ]),
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

    it('returns the matches-group categories for "matches"', () => {
      expect(new Set(categoryFilter('matches'))).toEqual(
        new Set([
          'match_live_follow',
          'match_live_bookmark',
          'match_finished',
          'match_deciding_set',
          'match_upset_live',
          'next_match_drawn',
        ]),
      )
    })

    it('returns all non-matches-group categories for "updates"', () => {
      expect(new Set(categoryFilter('updates'))).toEqual(
        new Set([
          // results
          'player_title_won',
          'player_eliminated',
          'ranking_updated',
          'ranking_threshold',
          'projection_outperform',
          // tournaments
          'tournament_starting',
          'draw_released',
          'player_entered',
          'player_path',
          // predictions
          'prematch_prediction',
          'daily_oop',
          'weekly_digest',
          'tournament_wrapup',
          'marketing',
        ]),
      )
    })

    it('returns empty array for unknown filter values (including the old "badges")', () => {
      expect(categoryFilter('badges')).toEqual([])
      expect(categoryFilter('foo')).toEqual([])
    })
  })
})

describe('category tiers', () => {
  it('every known category has tier + group + comingSoon metadata', () => {
    for (const cat of KNOWN_CATEGORIES_TIER) {
      expect(CATEGORY_META[cat]).toBeDefined()
      expect(['free', 'pro']).toContain(CATEGORY_META[cat].tier)
      expect(CATEGORY_GROUPS).toContain(CATEGORY_META[cat].group)
      expect(typeof CATEGORY_META[cat].comingSoon).toBe('boolean')
    }
  })
  it('only categories with real senders are live (not comingSoon)', () => {
    const live = KNOWN_CATEGORIES_TIER.filter((c) => !CATEGORY_META[c].comingSoon)
    expect(live.sort()).toEqual(['marketing', 'match_finished', 'match_live_bookmark', 'match_live_follow'])
  })
  it('existing categories stay free', () => {
    expect(isProCategory('match_live_follow')).toBe(false)
    expect(isProCategory('match_finished')).toBe(false)
    expect(isProCategory('marketing')).toBe(false)
  })
  it('new pro categories are pro', () => {
    expect(isProCategory('match_deciding_set')).toBe(true)
    expect(isProCategory('prematch_prediction')).toBe(true)
    expect(isProCategory('projection_outperform')).toBe(true)
  })
  it('new free categories are free', () => {
    expect(isProCategory('daily_oop')).toBe(false)
    expect(isProCategory('draw_released')).toBe(false)
    expect(isProCategory('weekly_digest')).toBe(false)
  })
  it('categoriesForTier(free) excludes pro categories', () => {
    const free = categoriesForTier('free')
    expect(free).toContain('match_finished')
    expect(free).not.toContain('match_deciding_set')
  })
  it('categoriesForTier(pro) includes everything', () => {
    expect(categoriesForTier('pro')).toEqual(KNOWN_CATEGORIES_TIER)
  })
})

describe('shouldDeliverToRecipient', () => {
  it('free category always delivers', () => {
    expect(shouldDeliverToRecipient('match_finished', false)).toBe(true)
    expect(shouldDeliverToRecipient('match_finished', true)).toBe(true)
  })
  it('pro category delivers only to pro recipients', () => {
    expect(shouldDeliverToRecipient('match_deciding_set', false)).toBe(false)
    expect(shouldDeliverToRecipient('match_deciding_set', true)).toBe(true)
  })
})
