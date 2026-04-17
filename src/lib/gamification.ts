// src/lib/gamification.ts
// Pure helpers for the profile hero: XP computation, compact XP
// formatting, and next-achievement selection. No IO, no DOM — lives
// here so it can be unit-tested in isolation and reused beyond the
// profile page if needed.

import { BADGE_CATALOG, type BadgeDefinition, type EvalType } from './badges'
import type { EarnedBadge } from '../hooks/useBadges'

// ── XP ───────────────────────────────────────────────────────────

export const TIER_XP: Record<1 | 2 | 3 | 4, number> = {
  1: 10,
  2: 25,
  3: 60,
  4: 150,
}

/**
 * Compute derived XP from earned badges + current login streak.
 *
 * Each earned badge tier contributes TIER_XP[tier]. Login streak
 * contributes `5 × loginStreak` — not cumulative, so a broken streak
 * visibly costs XP. That's intentional (Duolingo pattern).
 *
 * Single-tier badges that happen to report `tier: 1` also count — they
 * simply earn the Rookie weight, which is correct.
 */
export function computeXp(earnedBadges: EarnedBadge[], loginStreak: number): number {
  const badgeXp = earnedBadges.reduce((sum, b) => {
    const weight = TIER_XP[b.tier as 1 | 2 | 3 | 4] ?? 0
    return sum + weight
  }, 0)
  const streakXp = Math.max(0, loginStreak) * 5
  return badgeXp + streakXp
}

/**
 * Compact XP formatter. `1234 → "1.2k"`, `1_500_000 → "1.5m"`, `42 → "42"`.
 * Floors at one decimal so `999 → "999"` but `1000 → "1.0k"`.
 */
export function formatXp(xp: number): string {
  if (xp >= 1_000_000) return `${(xp / 1_000_000).toFixed(1)}m`
  if (xp >= 1000) return `${(xp / 1000).toFixed(1)}k`
  return String(Math.max(0, Math.floor(xp)))
}

// ── Next-achievement selection ──────────────────────────────────

export interface Counts {
  /** bookmark_count on `user_bookmarks.bookmark_type = 'player'` */
  playerFollowCount: number
  /** bookmark_count on `user_bookmarks.bookmark_type = 'tournament'` */
  tournamentFollowCount: number
  /** bookmark_count on `user_bookmarks.bookmark_type = 'match'` */
  matchBookmarkCount: number
  /** COUNT match_ratings */
  ratingCount: number
  /** COUNT user_activity_log WHERE action='article_click' */
  articleClickCount: number
  /** COUNT user_activity_log WHERE action='video_play' */
  videoPlayCount: number
  /** COUNT user_activity_log WHERE action='share' */
  shareCount: number
  /** profiles.login_streak for this user */
  loginStreak: number
  /** profiles.longest_streak for this user */
  longestStreak: number
  /** COUNT profiles WHERE referred_by = currentUser.id */
  referralCount: number
}

export interface NextChase {
  badge: BadgeDefinition
  tierNum: 1 | 2 | 3 | 4
  current: number
  threshold: number
  pct: number  // in [0, 1)
}

/**
 * Resolve the "live" count for a badge definition against the fetched
 * Counts. Returns 0 for badge types the progress card doesn't chase
 * (single-tier evals are handled upstream by the caller).
 */
function getCurrentCount(def: BadgeDefinition, counts: Counts): number {
  const t: EvalType = def.evalType
  if (t === 'bookmark_count') {
    if (def.evalParam === 'player') return counts.playerFollowCount
    if (def.evalParam === 'tournament') return counts.tournamentFollowCount
    if (def.evalParam === 'match') return counts.matchBookmarkCount
    return 0
  }
  if (t === 'rating_count') return counts.ratingCount
  if (t === 'activity_count') {
    if (def.evalParam === 'article_click') return counts.articleClickCount
    if (def.evalParam === 'video_play') return counts.videoPlayCount
    if (def.evalParam === 'share') return counts.shareCount
    return 0
  }
  if (t === 'login_streak') return counts.loginStreak
  if (t === 'longest_streak') return counts.longestStreak
  if (t === 'referral_count') return counts.referralCount
  // Single-tier eval types (profile_complete, early_adopter, feature_interest,
  // push_enabled) are excluded upstream — their progress is binary.
  return 0
}

/**
 * Pick the next tiered badge the user is closest to unlocking.
 *
 * Rules:
 * - Single-tier badges are never chased (progress is binary).
 * - A tiered badge contributes only if the user has some non-zero
 *   progress toward the next-unearned tier and hasn't hit it yet.
 * - Highest pct wins; ties break by BADGE_CATALOG order (first wins).
 * - Returns null when nothing qualifies (e.g. all tiers earned, or
 *   the user is brand-new with zero measurable progress anywhere).
 */
export function selectNextAchievement(
  earnedBadges: EarnedBadge[],
  counts: Counts,
): NextChase | null {
  // Highest tier earned per badge_id
  const earnedMax = new Map<string, number>()
  for (const b of earnedBadges) {
    const prev = earnedMax.get(b.badge_id) ?? 0
    if (b.tier > prev) earnedMax.set(b.badge_id, b.tier)
  }

  let best: NextChase | null = null

  for (const def of BADGE_CATALOG) {
    if (def.isSingleTier) continue

    const earnedTier = earnedMax.get(def.id) ?? 0
    const nextTier = def.tiers.find(t => t.tier === earnedTier + 1)
    if (!nextTier) continue // all tiers already earned

    const current = getCurrentCount(def, counts)
    if (current <= 0) continue

    const pct = current / nextTier.threshold
    if (pct >= 1) continue // threshold already met; badge should have been awarded separately

    if (!best || pct > best.pct) {
      best = {
        badge: def,
        tierNum: nextTier.tier,
        current,
        threshold: nextTier.threshold,
        pct,
      }
    }
  }

  return best
}
