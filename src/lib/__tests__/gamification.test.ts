// src/lib/__tests__/gamification.test.ts
//
// Run with: npx vitest run src/lib/__tests__/gamification.test.ts

import { describe, it, expect } from 'vitest'
import { computeXp, formatXp, selectNextAchievement, TIER_XP, type Counts } from '../gamification'
import type { EarnedBadge } from '../../hooks/useBadges'

function makeBadge(badge_id: string, tier: 1 | 2 | 3 | 4): EarnedBadge {
  return { badge_id, tier, unlocked_at: '2026-04-01T00:00:00Z' }
}

const emptyCounts: Counts = {
  playerFollowCount: 0,
  tournamentFollowCount: 0,
  matchBookmarkCount: 0,
  ratingCount: 0,
  articleClickCount: 0,
  videoPlayCount: 0,
  shareCount: 0,
  loginStreak: 0,
  longestStreak: 0,
  referralCount: 0,
}

// ── computeXp ────────────────────────────────────────────────────

describe('computeXp', () => {
  it('returns 0 for no badges and no streak', () => {
    expect(computeXp([], 0)).toBe(0)
  })

  it('sums tier weights for earned badges', () => {
    const badges: EarnedBadge[] = [
      makeBadge('follow_players', 1),
      makeBadge('follow_players', 2),
      makeBadge('login_streak', 3),
    ]
    // 10 + 25 + 60 = 95
    expect(computeXp(badges, 0)).toBe(TIER_XP[1] + TIER_XP[2] + TIER_XP[3])
  })

  it('adds 5 × streak for a live streak', () => {
    expect(computeXp([], 7)).toBe(35)
  })

  it('sums badge xp + streak xp', () => {
    const badges: EarnedBadge[] = [makeBadge('follow_players', 4)]
    expect(computeXp(badges, 10)).toBe(TIER_XP[4] + 50) // 150 + 50
  })

  it('treats negative streak as 0', () => {
    expect(computeXp([], -5)).toBe(0)
  })

  it('single-tier badges reported as tier 1 use the Rookie weight', () => {
    const badges: EarnedBadge[] = [makeBadge('profile_complete', 1)]
    expect(computeXp(badges, 0)).toBe(TIER_XP[1])
  })

  it('ignores badges with unexpected tier values', () => {
    const badges = [{ badge_id: 'weird', tier: 99, unlocked_at: '' }] as EarnedBadge[]
    expect(computeXp(badges, 0)).toBe(0)
  })
})

// ── formatXp ─────────────────────────────────────────────────────

describe('formatXp', () => {
  it('returns the raw integer below 1000', () => {
    expect(formatXp(0)).toBe('0')
    expect(formatXp(42)).toBe('42')
    expect(formatXp(999)).toBe('999')
  })

  it('formats thousands with one decimal and a k suffix', () => {
    expect(formatXp(1000)).toBe('1.0k')
    expect(formatXp(1234)).toBe('1.2k')
    expect(formatXp(99_900)).toBe('99.9k')
  })

  it('formats millions with one decimal and an m suffix', () => {
    expect(formatXp(1_000_000)).toBe('1.0m')
    expect(formatXp(1_500_000)).toBe('1.5m')
  })

  it('clamps negative input to 0', () => {
    expect(formatXp(-10)).toBe('0')
  })
})

// ── selectNextAchievement ───────────────────────────────────────

describe('selectNextAchievement', () => {
  it('returns null when the user has no measurable progress anywhere', () => {
    expect(selectNextAchievement([], emptyCounts)).toBeNull()
  })

  it('returns null when only single-tier badges are earnable', () => {
    // Single-tier badges (profile_complete, early_adopter, etc.) are excluded.
    // With only single-tier progress, there's nothing to chase.
    expect(selectNextAchievement([makeBadge('profile_complete', 1)], emptyCounts)).toBeNull()
  })

  it('picks the badge with the highest fractional progress', () => {
    const counts: Counts = {
      ...emptyCounts,
      playerFollowCount: 3,       // follow_players tier 1 threshold 1 → tier 2 threshold 5 → 3/5 = 0.6
      matchBookmarkCount: 2,      // follow_matches tier 1 threshold 1 → tier 2 threshold 10 → 2/10 = 0.2
    }
    // Pretend tier 1 of both badges is already earned so we're chasing tier 2
    const earned: EarnedBadge[] = [
      makeBadge('follow_players', 1),
      makeBadge('follow_matches', 1),
    ]
    const next = selectNextAchievement(earned, counts)
    expect(next).not.toBeNull()
    expect(next!.badge.id).toBe('follow_players')
    expect(next!.tierNum).toBe(2)
    expect(next!.current).toBe(3)
    expect(next!.threshold).toBe(5)
    expect(next!.pct).toBeCloseTo(0.6, 5)
  })

  it('skips badges already at or above threshold', () => {
    const counts: Counts = { ...emptyCounts, playerFollowCount: 20 }
    // No earned tiers → tier 1 threshold is 1, 20/1 = 20 → skipped (pct >= 1)
    // Tier 2 threshold 5, 20/5 = 4 → skipped
    // Tier 3 threshold 15, 20/15 ≈ 1.33 → skipped
    // All tiers of follow_players are at threshold → should skip
    const result = selectNextAchievement([], counts)
    // No other progress in counts → null
    expect(result).toBeNull()
  })

  it('returns null when all tiered badges are fully earned', () => {
    // follow_players has 3 tiers; simulate all earned.
    const earned: EarnedBadge[] = [
      makeBadge('follow_players', 1),
      makeBadge('follow_players', 2),
      makeBadge('follow_players', 3),
    ]
    const counts: Counts = { ...emptyCounts, playerFollowCount: 100 }
    expect(selectNextAchievement(earned, counts)).toBeNull()
  })

  it('breaks ties by BADGE_CATALOG order (first wins)', () => {
    // Craft two badges with identical pct; earlier-in-catalog wins.
    // follow_players tier 1 threshold 1; follow_tournaments tier 1 threshold 1.
    // Both at count=0.5 isn't possible (integer counts), so use
    // follow_players 1 already earned with count 3 toward threshold 5 (0.6)
    // and follow_tournaments 1 already earned with count ~1.8 toward threshold 3 (0.6).
    // Since counts are integers we simulate with count=3/5 and count=1/3 ≈ 0.333 —
    // better to use known-equal fractions: 2/10 and 1/5 both = 0.2.
    const counts: Counts = {
      ...emptyCounts,
      matchBookmarkCount: 2,     // tier 1 earned; tier 2 threshold 10 → 0.2
      playerFollowCount: 1,      // tier 1 earned; tier 2 threshold 5 → 0.2
    }
    const earned: EarnedBadge[] = [
      makeBadge('follow_players', 1),
      makeBadge('follow_matches', 1),
    ]
    const next = selectNextAchievement(earned, counts)
    expect(next).not.toBeNull()
    // follow_players appears in BADGE_CATALOG before follow_matches
    expect(next!.badge.id).toBe('follow_players')
  })
})
