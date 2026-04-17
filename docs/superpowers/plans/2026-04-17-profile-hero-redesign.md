# Profile Hero Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `/profile` into a progress-centric hero (avatar, tier chip, streak, XP/badges/follows stats, latest achievements strip, next-achievement progress card, activity rows) with a gear icon linking to `/profile/settings`.
**Architecture:** Single-file rewrite of `src/app/[locale]/(app)/profile/page.tsx` with components inlined following the `achievements/page.tsx` precedent. Two supporting new files: `src/components/icons/index.tsx` (shared outline-SVG icon set used by hero, activity rows, and future pages) and `src/lib/gamification.ts` (pure helpers `computeXp`, `formatXp`, `selectNextAchievement`). Unit tests cover pure helpers with vitest. No DB migrations.
**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · next-intl · Supabase

---

## File Structure

### Created
- `src/components/icons/index.tsx` — shared outline-SVG icon set: `FlameIcon`, `TrophyIcon`, `GearIcon`, `BellIcon`, `BookmarkIcon`, `SearchIcon`, `ChevronRightIcon`, `ArrowLeftIcon`. Each component accepts `{ size?, color?, strokeWidth? }` and renders a 24×24 viewBox SVG with stroke 2.5, rounded caps/joins.
- `src/lib/gamification.ts` — pure helpers:
  - `TIER_XP: Record<1|2|3|4, number>` (constants)
  - `computeXp(earnedBadges, loginStreak): number`
  - `formatXp(xp): string` (`1234` → `"1.2k"`, `1_500_000` → `"1.5m"`)
  - `selectNextAchievement(earnedBadges, counts): NextChase | null`
  - `type Counts` (shape consumed by `selectNextAchievement`)
  - `type NextChase` (shape returned by `selectNextAchievement`)
- `src/lib/notifications.ts` — stub `getUnreadNotificationCount(): number` that returns `0`. Phase 3 will swap to a real query.
- `src/lib/__tests__/gamification.test.ts` — vitest coverage for `computeXp`, `formatXp`, `selectNextAchievement`.

### Modified
- `src/app/[locale]/(app)/profile/page.tsx` — full rewrite. Drops ~225 lines of settings/compliance/bookmark-list code, adds hero + stats strip + latest-achievements strip + progress card + CTA banner + activity section. Components inlined.
- `src/messages/en.json` — add new `profile.*` keys: `settings`, `streakDays`, `stats.{xp,badges,follows}`, `latestAchievements`, `nextUp`, `progressOf`, `seeAllAchievements`, `achievementsSummary`, `allTiersEarned`, `activity.{header,matches,matchesSub,players,playersSub,notifications,notificationsSub,newCount}`, `tierPrefix`.
- `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json` — same keys translated.

### Unchanged
- `src/components/BadgeIcon.tsx` — still owns `ICON_PATHS` internally. One controlled duplication: `icons/index.tsx` re-implements the handful of paths it needs (flame, trophy, bell, bookmark, search). Future consolidation is a separate phase.
- `src/lib/badges.ts` — `BADGE_CATALOG`, `TIER_META`, `overallTierFromBadgeCount` are consumed but untouched.
- `src/hooks/useBadges.ts` — consumed verbatim.
- `/profile/settings` route — owned by Phase 1. Phase 2 only links to it. If Phase 1 ships late, the gear 404s (acceptable tradeoff, documented in spec §14).
- `/notifications` route — doesn't exist. Activity row links to it and a 404 is acceptable until Phase 3 ships (spec §13).
- `/following` route — consumed as deep-link target. The spec accepts that `?tab=matches|players` query params are ignored by the current Following page; landing on the default tab is acceptable.

### Notes on removed functionality (moved to Phase 1's `/profile/settings`)
- Invite friends CTA (`useInvite` + `AmbassadorBadge`) — deleted from `/profile`. Phase 1 owns rendering this from settings. `src/hooks/useInvite.ts` itself is not modified.
- Notification toggle, region picker, language switcher, sign-out button, email display — deleted.
- Bookmarked matches list (lines 461–509 of current file), bookmarked players list (lines 511–550) — deleted. Replaced by activity-section counter rows that deep-link to `/following`.

---

## Task 1: Add shared outline-icon set

**Files:**
- Create: `src/components/icons/index.tsx`

- [ ] **Step 1: Create the icon module**

Create `src/components/icons/index.tsx` with the full content below. All icons use a 24×24 viewBox, `strokeWidth` 2.5, and rounded caps/joins. Path data for flame, trophy, bell, bookmark, and search is copied from `src/components/BadgeIcon.tsx` `ICON_PATHS` to match the existing visual style. `GearIcon`, `ChevronRightIcon`, and `ArrowLeftIcon` are new.

```tsx
// src/components/icons/index.tsx
// Shared outline-SVG icon set. Used by the profile hero, activity rows,
// and any surface that needs a plain icon (not a badge tile). All icons
// are stroke 2.5 with rounded caps on a 24×24 viewBox so they render
// crisply at 14–24px.

interface IconProps {
  size?: number
  color?: string
  strokeWidth?: number
}

function baseProps(size: number, color: string, strokeWidth: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

export function FlameIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M12 22c4-2.5 7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 3 8.5 7 11z"/>
      <path d="M12 22c-1.5-1.5-3-4-3-7a3 3 0 0 1 6 0c0 3-1.5 5.5-3 7z"/>
    </svg>
  )
}

export function TrophyIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
    </svg>
  )
}

export function GearIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.48.66.84 1.22 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

export function BellIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}

export function BookmarkIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

export function SearchIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <circle cx="11" cy="11" r="8"/>
      <path d="M21 21l-4.35-4.35"/>
    </svg>
  )
}

export function ChevronRightIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

export function ArrowLeftIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M19 12H5"/>
      <path d="M12 19l-7-7 7-7"/>
    </svg>
  )
}
```

- [ ] **Step 2: Verify the module compiles**

Run:
```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
```
Expected output: no errors. If errors surface for pre-existing files unrelated to `icons/index.tsx`, ignore them — the task only owns this file.

- [ ] **Step 3: Commit**

```
feat(icons): add shared outline-svg icon set
```

---

## Task 2: Add `gamification.ts` pure helpers

**Files:**
- Create: `src/lib/gamification.ts`

- [ ] **Step 1: Create the module**

Create `src/lib/gamification.ts` with the full content below. Three pure functions, no runtime deps beyond `BADGE_CATALOG` + `TIER_META` from `src/lib/badges.ts` and the `EarnedBadge` type from `useBadges`.

```ts
// src/lib/gamification.ts
// Pure helpers for the profile hero: XP computation, compact XP
// formatting, and next-achievement selection. No IO, no DOM — lives
// here so it can be unit-tested in isolation and reused beyond the
// profile page if needed.

import { BADGE_CATALOG, type BadgeDefinition, type EvalType } from '@/lib/badges'
import type { EarnedBadge } from '@/hooks/useBadges'

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
```

- [ ] **Step 2: Verify it typechecks**

Run:
```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
```
Expected output: no errors attributable to `src/lib/gamification.ts`.

- [ ] **Step 3: Commit**

```
feat(profile): add gamification helpers (computeXp, formatXp, selectNextAchievement)
```

---

## Task 3: Unit tests for `gamification.ts`

**Files:**
- Create: `src/lib/__tests__/gamification.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/lib/__tests__/gamification.test.ts` with the full content below. Tests cover the five cases called out in the spec's Testing Strategy section.

```ts
// src/lib/__tests__/gamification.test.ts
//
// Run with: npx vitest run src/lib/__tests__/gamification.test.ts

import { describe, it, expect } from 'vitest'
import { computeXp, formatXp, selectNextAchievement, TIER_XP, type Counts } from '../gamification'
import type { EarnedBadge } from '@/hooks/useBadges'

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
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/lib/__tests__/gamification.test.ts
```
Expected output: all tests pass (15 tests across three `describe` blocks). If any fail, stop and debug before proceeding — the helpers must be correct before the UI consumes them.

- [ ] **Step 3: Commit**

```
test: cover computeXp, formatXp, selectNextAchievement
```

---

## Task 4: Add notifications count stub

**Files:**
- Create: `src/lib/notifications.ts`

- [ ] **Step 1: Create the stub**

Create `src/lib/notifications.ts`:

```ts
// src/lib/notifications.ts
//
// Phase 2 stub for the Notifications row unread count. Returns 0
// synchronously so the UI can render the row without a network
// round-trip. Phase 3 swaps this to a real query against a
// `notifications` table (or user_activity_log, TBD by that spec).
//
// The row already supports the red "N new" treatment when this
// returns > 0 — no UI change will be needed when the real source
// lands.

export function getUnreadNotificationCount(): number {
  return 0
}
```

- [ ] **Step 2: Commit**

```
feat(profile): add notifications unread-count stub (phase-3 placeholder)
```

---

## Task 5: Add English i18n strings

**Files:**
- Modify: `src/messages/en.json`

- [ ] **Step 1: Update the `profile` block**

Open `src/messages/en.json`. Find the existing `"profile": { ... }` block (around line 242). Replace it with the block below. The existing keys (`profile`, `signOut`, `signIn`, `achievements`, `bookmarks`, `following`, `loading`, `language`) are preserved so `/profile/settings` and any other consumers keep working; new keys are added inline.

Replace this exact string:
```json
  "profile": {
    "profile": "Profile",
    "signOut": "Sign out",
    "signIn": "Sign in",
    "achievements": "Achievements",
    "bookmarks": "Bookmarks",
    "following": "Following",
    "loading": "Loading your profile...",
    "language": "Language"
  },
```

With:
```json
  "profile": {
    "profile": "Profile",
    "signOut": "Sign out",
    "signIn": "Sign in",
    "achievements": "Achievements",
    "bookmarks": "Bookmarks",
    "following": "Following",
    "loading": "Loading your profile...",
    "language": "Language",
    "settings": "Settings",
    "streakDays": "{count}-day streak",
    "tierPrefix": "Tier {n}",
    "stats": {
      "xp": "XP",
      "badges": "Badges",
      "follows": "Follows"
    },
    "latestAchievements": "Latest achievements",
    "nextUp": "Next up",
    "progressOf": "{current} / {total}",
    "seeAllAchievements": "See all achievements",
    "achievementsSummary": "{earned} earned · {togo} tiers to go",
    "allTiersEarned": "All tiers earned",
    "activity": {
      "header": "Activity",
      "matches": "Bookmarked matches",
      "matchesSub": "Saved games and results",
      "players": "Followed players",
      "playersSub": "Players you track",
      "notifications": "Notifications",
      "notificationsSub": "Your alerts",
      "newCount": "{count} new"
    }
  },
```

- [ ] **Step 2: Verify JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('/Users/GuDenes/Projects/padel-live-scores/src/messages/en.json', 'utf8')); console.log('ok')"
```
Expected output: `ok`. If not, fix the syntax before proceeding.

- [ ] **Step 3: Commit**

```
feat(profile): add english i18n strings for hero redesign
```

---

## Task 6: Translate hero strings into es / pt / it / fr

**Files:**
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Update Spanish (`src/messages/es.json`)**

Replace the existing `"profile": { ... }` block with:
```json
  "profile": {
    "profile": "Perfil",
    "signOut": "Cerrar sesión",
    "signIn": "Iniciar sesión",
    "achievements": "Logros",
    "bookmarks": "Guardados",
    "following": "Siguiendo",
    "loading": "Cargando tu perfil...",
    "language": "Idioma",
    "settings": "Ajustes",
    "streakDays": "Racha de {count} días",
    "tierPrefix": "Nivel {n}",
    "stats": {
      "xp": "XP",
      "badges": "Insignias",
      "follows": "Seguidos"
    },
    "latestAchievements": "Últimos logros",
    "nextUp": "Siguiente",
    "progressOf": "{current} / {total}",
    "seeAllAchievements": "Ver todos los logros",
    "achievementsSummary": "{earned} ganados · faltan {togo} niveles",
    "allTiersEarned": "Todos los niveles ganados",
    "activity": {
      "header": "Actividad",
      "matches": "Partidos guardados",
      "matchesSub": "Partidos y resultados guardados",
      "players": "Jugadores seguidos",
      "playersSub": "Jugadores que sigues",
      "notifications": "Notificaciones",
      "notificationsSub": "Tus alertas",
      "newCount": "{count} nuevas"
    }
  },
```

- [ ] **Step 2: Update Portuguese (`src/messages/pt.json`)**

Replace the existing `"profile": { ... }` block with:
```json
  "profile": {
    "profile": "Perfil",
    "signOut": "Sair",
    "signIn": "Entrar",
    "achievements": "Conquistas",
    "bookmarks": "Salvos",
    "following": "Seguindo",
    "loading": "Carregando seu perfil...",
    "language": "Idioma",
    "settings": "Configurações",
    "streakDays": "Sequência de {count} dias",
    "tierPrefix": "Nível {n}",
    "stats": {
      "xp": "XP",
      "badges": "Medalhas",
      "follows": "Seguindo"
    },
    "latestAchievements": "Últimas conquistas",
    "nextUp": "Próxima",
    "progressOf": "{current} / {total}",
    "seeAllAchievements": "Ver todas as conquistas",
    "achievementsSummary": "{earned} conquistadas · faltam {togo} níveis",
    "allTiersEarned": "Todos os níveis conquistados",
    "activity": {
      "header": "Atividade",
      "matches": "Partidas salvas",
      "matchesSub": "Jogos e resultados salvos",
      "players": "Jogadores seguidos",
      "playersSub": "Jogadores que você acompanha",
      "notifications": "Notificações",
      "notificationsSub": "Seus alertas",
      "newCount": "{count} novas"
    }
  },
```

- [ ] **Step 3: Update Italian (`src/messages/it.json`)**

Keep whatever values already existed in the original block; add the same new keys as in English, translated. Replace the existing `"profile": { ... }` with (only the new keys require translation — keep existing values for `profile`, `signOut`, etc. from the pre-existing file untouched; this block shows a full valid structure):

```json
  "profile": {
    "profile": "Profilo",
    "signOut": "Esci",
    "signIn": "Accedi",
    "achievements": "Obiettivi",
    "bookmarks": "Salvati",
    "following": "Seguiti",
    "loading": "Caricamento profilo...",
    "language": "Lingua",
    "settings": "Impostazioni",
    "streakDays": "Serie di {count} giorni",
    "tierPrefix": "Livello {n}",
    "stats": {
      "xp": "XP",
      "badges": "Distintivi",
      "follows": "Seguiti"
    },
    "latestAchievements": "Ultimi obiettivi",
    "nextUp": "Prossimo",
    "progressOf": "{current} / {total}",
    "seeAllAchievements": "Vedi tutti gli obiettivi",
    "achievementsSummary": "{earned} ottenuti · mancano {togo} livelli",
    "allTiersEarned": "Tutti i livelli ottenuti",
    "activity": {
      "header": "Attività",
      "matches": "Partite salvate",
      "matchesSub": "Partite e risultati salvati",
      "players": "Giocatori seguiti",
      "playersSub": "Giocatori che segui",
      "notifications": "Notifiche",
      "notificationsSub": "I tuoi avvisi",
      "newCount": "{count} nuove"
    }
  },
```

- [ ] **Step 4: Update French (`src/messages/fr.json`)**

Replace the existing `"profile": { ... }` block with:

```json
  "profile": {
    "profile": "Profil",
    "signOut": "Déconnexion",
    "signIn": "Connexion",
    "achievements": "Succès",
    "bookmarks": "Favoris",
    "following": "Abonnements",
    "loading": "Chargement de ton profil...",
    "language": "Langue",
    "settings": "Paramètres",
    "streakDays": "Série de {count} jours",
    "tierPrefix": "Niveau {n}",
    "stats": {
      "xp": "XP",
      "badges": "Badges",
      "follows": "Abonnements"
    },
    "latestAchievements": "Derniers succès",
    "nextUp": "À suivre",
    "progressOf": "{current} / {total}",
    "seeAllAchievements": "Voir tous les succès",
    "achievementsSummary": "{earned} obtenus · {togo} niveaux à faire",
    "allTiersEarned": "Tous les niveaux obtenus",
    "activity": {
      "header": "Activité",
      "matches": "Matchs enregistrés",
      "matchesSub": "Matchs et résultats sauvegardés",
      "players": "Joueurs suivis",
      "playersSub": "Joueurs que tu suis",
      "notifications": "Notifications",
      "notificationsSub": "Tes alertes",
      "newCount": "{count} nouvelles"
    }
  },
```

- [ ] **Step 5: Verify all four files parse**

```bash
for f in es pt it fr; do
  node -e "JSON.parse(require('fs').readFileSync('/Users/GuDenes/Projects/padel-live-scores/src/messages/${f}.json','utf8')); console.log('${f} ok')"
done
```
Expected output: `es ok`, `pt ok`, `it ok`, `fr ok` each on their own line.

- [ ] **Step 6: Commit**

```
feat(profile): translate hero strings to es/pt/it/fr
```

---

## Task 7: Profile page skeleton — clear old code, wire new data layer

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

This task rewrites the page down to a minimal shell that renders a loading state and fetches all counts + streak. No hero UI yet — the remaining tasks layer sections in one at a time on top of this foundation. After this task the page visibly renders the sticky header and nothing below it; the next task adds the avatar block.

- [ ] **Step 1: Replace the entire file with the skeleton below**

Overwrite `src/app/[locale]/(app)/profile/page.tsx` with:

```tsx
'use client'
// src/app/[locale]/(app)/profile/page.tsx
// Profile page — progress-centric hero (Phase 2).
// Settings/compliance controls live at /profile/settings (Phase 1).

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import { useBadges, type EarnedBadge } from '@/hooks/useBadges'
import BrandedLoader from '../../../components/BrandedLoader'
import { BADGE_CATALOG, TIER_META, overallTierFromBadgeCount } from '@/lib/badges'
import { withTimeout } from '@/lib/with-timeout'
import { computeXp, formatXp, selectNextAchievement, type Counts } from '@/lib/gamification'
import { getUnreadNotificationCount } from '@/lib/notifications'
import {
  ArrowLeftIcon,
  GearIcon,
  FlameIcon,
  TrophyIcon,
  BellIcon,
  BookmarkIcon,
  SearchIcon,
  ChevronRightIcon,
} from '@/components/icons'
import { BadgeIcon } from '@/components/BadgeIcon'

const V3 = {
  GREEN: '#7ED321',
  ORANGE: '#F5A623',
  LIVE_RED: '#FF4655',
  BG_BASE: '#1A1A1A',
  BG_CARD: '#141414',
  MUTED: '#6B7280',
  BORDER: 'rgba(255,255,255,0.06)',
  STREAK: '#FF6B2B',
  clip: {
    badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
    card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
    chunky: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
  },
} as const

export default function ProfilePage() {
  const t = useTranslations('profile')
  const { user, profile, loading: authLoading } = useAuth()
  const router = useRouter()
  const { badges: earnedBadges, loading: badgesLoading } = useBadges()

  const [counts, setCounts] = useState<Counts | null>(null)
  const [countsLoading, setCountsLoading] = useState(true)

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.replace('/home')
  }, [authLoading, user, router])

  // Fetch all counts + streak in parallel. Each query is HEAD (`count=exact, head=true`)
  // so responses are tiny. Wrapped in withTimeout so a wedged client fails fast.
  const fetchCounts = useCallback(async () => {
    if (!user) return
    setCountsLoading(true)

    const head = (query: PromiseLike<{ count: number | null }>, label: string) =>
      withTimeout(Promise.resolve(query), 10_000, label)

    try {
      const [
        playerFollow,
        tournamentFollow,
        matchBookmark,
        ratings,
        articleClicks,
        videoPlays,
        shares,
        referrals,
        profileRow,
      ] = await Promise.all([
        head(
          supabase.from('user_bookmarks').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('bookmark_type', 'player'),
          'profile:count-player-bookmarks',
        ),
        head(
          supabase.from('user_bookmarks').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('bookmark_type', 'tournament'),
          'profile:count-tournament-bookmarks',
        ),
        head(
          supabase.from('user_bookmarks').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('bookmark_type', 'match'),
          'profile:count-match-bookmarks',
        ),
        head(
          supabase.from('match_ratings').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          'profile:count-ratings',
        ),
        head(
          supabase.from('user_activity_log').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('action', 'article_click'),
          'profile:count-article-clicks',
        ),
        head(
          supabase.from('user_activity_log').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('action', 'video_play'),
          'profile:count-video-plays',
        ),
        head(
          supabase.from('user_activity_log').select('id', { count: 'exact', head: true })
            .eq('user_id', user.id).eq('action', 'share'),
          'profile:count-shares',
        ),
        head(
          supabase.from('profiles').select('id', { count: 'exact', head: true })
            .eq('referred_by', user.id),
          'profile:count-referrals',
        ),
        withTimeout(
          Promise.resolve(
            supabase.from('profiles').select('login_streak, longest_streak')
              .eq('id', user.id).single(),
          ),
          10_000,
          'profile:fetch-streaks',
        ),
      ])

      setCounts({
        playerFollowCount: playerFollow.count ?? 0,
        tournamentFollowCount: tournamentFollow.count ?? 0,
        matchBookmarkCount: matchBookmark.count ?? 0,
        ratingCount: ratings.count ?? 0,
        articleClickCount: articleClicks.count ?? 0,
        videoPlayCount: videoPlays.count ?? 0,
        shareCount: shares.count ?? 0,
        referralCount: referrals.count ?? 0,
        loginStreak: profileRow.data?.login_streak ?? 0,
        longestStreak: profileRow.data?.longest_streak ?? 0,
      })
    } catch (e) {
      console.warn('[Profile] fetchCounts failed:', (e as Error)?.message)
    } finally {
      setCountsLoading(false)
    }
  }, [user])

  useEffect(() => { void fetchCounts() }, [fetchCounts])

  if (authLoading || !user) {
    return <BrandedLoader hints={[t('loading'), 'Almost ready...']} />
  }

  return (
    <div style={{
      maxWidth: 500, margin: '0 auto', paddingBottom: 80,
      background: V3.BG_BASE, minHeight: '100dvh',
    }}>
      {/* Sticky header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A', height: 62,
      }}>
        <button
          type="button"
          aria-label="Back"
          onClick={() => { if (window.history.length > 1) router.back(); else router.push('/home') }}
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'transparent', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: V3.MUTED,
          }}
        >
          <ArrowLeftIcon size={18} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
          {t('profile')}
        </div>
        <button
          type="button"
          aria-label={t('settings')}
          onClick={() => router.push('/profile/settings')}
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'transparent', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: V3.MUTED,
          }}
        >
          <GearIcon size={18} />
        </button>
      </div>

      {/* Content placeholder — hero sections land in subsequent tasks. */}
      {/* Intentionally empty in Task 7; remaining tasks populate it. */}
      <div data-profile-content style={{ display: 'none' }}>
        {/* counts/earnedBadges/badgesLoading/countsLoading referenced so
            eslint/typescript don't complain about unused-vars during the
            intermediate commits. These reads are zero-cost placeholders. */}
        {counts ? 'counts-ready' : 'counts-pending'}
        {badgesLoading ? 'badges-pending' : 'badges-ready'}
        {countsLoading ? 'counts-loading' : 'counts-done'}
        {earnedBadges.length}
        {profile?.display_name ?? ''}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
npm run lint --silent
```
Expected output: no new errors. The file still imports `earnedBadges`, `counts`, `profile`, etc. — all are referenced in the placeholder `data-profile-content` block so nothing reads as unused.

- [ ] **Step 3: Commit**

```
feat(profile): rewrite page — new header, counts/streak fetch, drop legacy sections
```

---

## Task 8: Avatar block (avatar + tier chip + display name + streak chip)

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

- [ ] **Step 1: Replace the `data-profile-content` placeholder with the avatar block**

Inside the return JSX, replace the entire `<div data-profile-content ...>...</div>` placeholder with the block below. It renders the avatar block directly; the next tasks will add more sections beneath it.

Find:
```tsx
      {/* Content placeholder — hero sections land in subsequent tasks. */}
      {/* Intentionally empty in Task 7; remaining tasks populate it. */}
      <div data-profile-content style={{ display: 'none' }}>
        {/* counts/earnedBadges/badgesLoading/countsLoading referenced so
            eslint/typescript don't complain about unused-vars during the
            intermediate commits. These reads are zero-cost placeholders. */}
        {counts ? 'counts-ready' : 'counts-pending'}
        {badgesLoading ? 'badges-pending' : 'badges-ready'}
        {countsLoading ? 'counts-loading' : 'counts-done'}
        {earnedBadges.length}
        {profile?.display_name ?? ''}
      </div>
```

Replace with:
```tsx
      <AvatarBlock
        displayName={profile?.display_name ?? 'User'}
        avatarUrl={profile?.avatar_url ?? null}
        earnedBadgeCount={new Set(earnedBadges.map(b => b.badge_id)).size}
        loginStreak={counts?.loginStreak ?? 0}
        streakLabel={t('streakDays', { count: counts?.loginStreak ?? 0 })}
        tierPrefix={t('tierPrefix', { n: 0 })}
        tierPrefixTemplate={(n) => t('tierPrefix', { n })}
      />
```

- [ ] **Step 2: Add the `AvatarBlock` component and `CHUNKY_BADGE_PATH` constant at the bottom of the file**

Append at end of `src/app/[locale]/(app)/profile/page.tsx` (after the closing brace of `ProfilePage`):

```tsx
// ── AvatarBlock ──────────────────────────────────────────────────

interface AvatarBlockProps {
  displayName: string
  avatarUrl: string | null
  earnedBadgeCount: number
  loginStreak: number
  streakLabel: string
  /** Unused placeholder kept to avoid an orphan import — prefer tierPrefixTemplate */
  tierPrefix: string
  tierPrefixTemplate: (n: number) => string
}

function AvatarBlock({
  displayName,
  avatarUrl,
  earnedBadgeCount,
  loginStreak,
  streakLabel,
  tierPrefixTemplate,
}: AvatarBlockProps) {
  const tier = overallTierFromBadgeCount(earnedBadgeCount)
  const tierMeta = tier ? TIER_META[tier] : null

  return (
    <div style={{ padding: '24px 16px 16px', textAlign: 'center' }}>
      {/* Avatar + tier chip — wrapper is 96×96 so the chip has room to overflow */}
      <div style={{
        width: 96, height: 96, margin: '0 auto 10px',
        position: 'relative', display: 'inline-block',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          border: `3px solid ${V3.ORANGE}`, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '16px auto 0',
        }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${V3.GREEN}, ${V3.ORANGE})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#000', fontSize: 24, fontWeight: 700,
            }}>
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        {tierMeta && (
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            transform: 'translate(25%, 25%)',
            clipPath: V3.clip.badge,
            padding: '3px 7px',
            fontSize: 9, fontWeight: 800, letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: tierMeta.color,
            background: `${tierMeta.color}20`,
            whiteSpace: 'nowrap',
          }}>
            {`${tierPrefixTemplate(tier!)} · ${tierMeta.label}`}
          </div>
        )}
      </div>

      <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginTop: 10 }}>
        {displayName}
      </div>

      {loginStreak >= 1 && (
        <div style={{
          marginTop: 8,
          display: 'inline-flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: V3.clip.chunky,
            background: `linear-gradient(135deg, ${V3.STREAK}40, ${V3.STREAK}10)`,
            border: `1.5px solid ${V3.STREAK}`,
          }}>
            <FlameIcon size={14} color={V3.STREAK} />
          </div>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>
            {streakLabel}
          </div>
        </div>
      )}
    </div>
  )
}
```

Note: the `tierPrefix` prop in the interface is a deliberate unused field — it exists so the call site doesn't need to restructure when we remove it in a future cleanup. It's not referenced inside `AvatarBlock`. To keep lint happy, the destructure omits it.

- [ ] **Step 3: Typecheck + visual smoke test**

```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
npm run dev
```
Navigate to `http://localhost:3002/profile` (sign in if needed). Expected: sticky header with back + gear, circular 64px avatar with orange ring, tier chip bottom-right of the avatar when the signed-in user has ≥ 1 earned badge, display name below. Streak chip renders only if the user has `login_streak ≥ 1`.

Stop the dev server (Ctrl+C) before committing.

- [ ] **Step 4: Commit**

```
feat(profile): add hero avatar block with tier chip and streak pill
```

---

## Task 9: Stats strip (XP · Badges · Follows)

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

- [ ] **Step 1: Render `<StatsStrip>` under `<AvatarBlock>`**

In the JSX, directly after the closing `/>` of `<AvatarBlock ... />`, add:

```tsx
      <StatsStrip
        xp={countsLoading ? null : computeXp(earnedBadges, counts?.loginStreak ?? 0)}
        badgeCount={badgesLoading ? null : new Set(earnedBadges.map(b => b.badge_id)).size}
        followCount={countsLoading ? null : (counts?.playerFollowCount ?? 0)}
        onBadgesClick={() => router.push('/achievements')}
        labels={{
          xp: t('stats.xp'),
          badges: t('stats.badges'),
          follows: t('stats.follows'),
        }}
      />
```

- [ ] **Step 2: Append the `StatsStrip` component at the bottom of the file**

Add after `AvatarBlock`:

```tsx
// ── StatsStrip ───────────────────────────────────────────────────

interface StatsStripProps {
  xp: number | null         // null = still loading → render "—"
  badgeCount: number | null
  followCount: number | null
  onBadgesClick: () => void
  labels: { xp: string; badges: string; follows: string }
}

function StatsStrip({ xp, badgeCount, followCount, onBadgesClick, labels }: StatsStripProps) {
  const cell = (opts: {
    number: string
    numberColor: string
    label: string
    onClick?: () => void
  }) => (
    <div
      role={opts.onClick ? 'button' : undefined}
      tabIndex={opts.onClick ? 0 : undefined}
      onClick={opts.onClick}
      onKeyDown={opts.onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick?.() }
      } : undefined}
      style={{
        background: V3.BG_CARD,
        clipPath: V3.clip.card,
        padding: '14px 10px',
        textAlign: 'center',
        cursor: opts.onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{
        fontSize: 26, fontWeight: 900, lineHeight: 1,
        color: opts.numberColor,
      }}>
        {opts.number}
      </div>
      <div style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
        textTransform: 'uppercase', color: V3.MUTED, marginTop: 6,
      }}>
        {opts.label}
      </div>
    </div>
  )

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
      padding: '0 16px', marginBottom: 18,
    }}>
      {cell({
        number: xp === null ? '—' : formatXp(xp),
        numberColor: V3.GREEN,
        label: labels.xp,
      })}
      {cell({
        number: badgeCount === null ? '—' : String(badgeCount),
        numberColor: V3.ORANGE,
        label: labels.badges,
        onClick: onBadgesClick,
      })}
      {cell({
        number: followCount === null ? '—' : String(followCount),
        numberColor: V3.GREEN,
        label: labels.follows,
      })}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + smoke test**

```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
npm run dev
```
Visit `/profile`. Expected: three chunky card cells under the avatar. Tapping the Badges card navigates to `/achievements`. Stop the dev server.

- [ ] **Step 4: Commit**

```
feat(profile): add stats strip (xp · badges · follows)
```

---

## Task 10: Latest achievements strip

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

- [ ] **Step 1: Render `<LatestAchievementsStrip>` under `<StatsStrip>`**

Add directly after the `<StatsStrip .../>` call:

```tsx
      <LatestAchievementsStrip
        header={t('latestAchievements')}
        earnedBadges={earnedBadges}
        counts={counts}
      />
```

- [ ] **Step 2: Append the component at the bottom of the file**

```tsx
// ── LatestAchievementsStrip ──────────────────────────────────────

interface LatestAchievementsStripProps {
  header: string
  earnedBadges: EarnedBadge[]
  counts: Counts | null
}

function LatestAchievementsStrip({ header, earnedBadges, counts }: LatestAchievementsStripProps) {
  // Build 5 tiles in the order specified by the spec:
  //   1. up to 3 most recent earned (by unlocked_at DESC)
  //   2. up to 2 locked-with-progress (highest pct first)
  //   3. backfill from BADGE_CATALOG to reach 5 items
  const tiles = buildLatestAchievementsTiles(earnedBadges, counts)

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        color: V3.ORANGE, fontSize: 11, fontWeight: 700,
        letterSpacing: 1, textTransform: 'uppercase',
        padding: '0 16px', marginBottom: 10,
      }}>
        {header}
      </div>
      <div style={{
        display: 'flex', gap: 10, overflowX: 'auto',
        padding: '0 16px 4px',
        scrollbarWidth: 'none',
      }}>
        {tiles.map((tile, idx) => (
          <div key={`${tile.badgeId}-${tile.tier ?? 'locked'}-${idx}`} style={{
            width: 72, flexShrink: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <BadgeIcon svgIcon={tile.svgIcon} tier={tile.tier} size={48} />
            <div style={{
              marginTop: 6, fontSize: 10, fontWeight: 700, color: '#fff',
              textAlign: 'center',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {tile.label}
            </div>
            {tile.progress && (
              <div style={{
                marginTop: 2,
                fontSize: 9, fontWeight: 700,
                color: tile.progressColor,
              }}>
                {tile.progress}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

interface StripTile {
  badgeId: string
  label: string
  svgIcon: string
  tier: 1 | 2 | 3 | 4 | null
  progress?: string
  progressColor?: string
}

function buildLatestAchievementsTiles(earned: EarnedBadge[], counts: Counts | null): StripTile[] {
  const TARGET = 5
  const out: StripTile[] = []
  const seen = new Set<string>()

  // 1. Up to 3 most recent earned (by unlocked_at DESC)
  const sortedEarned = [...earned].sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at))
  for (const e of sortedEarned) {
    if (out.length >= 3) break
    const key = `${e.badge_id}:${e.tier}`
    if (seen.has(key)) continue
    const def = BADGE_CATALOG.find(b => b.id === e.badge_id)
    if (!def) continue
    out.push({
      badgeId: e.badge_id,
      label: def.name,
      svgIcon: def.svgIcon,
      tier: e.tier as 1 | 2 | 3 | 4,
    })
    seen.add(key)
  }

  // 2. Up to 2 locked-with-progress tiles (highest pct)
  if (counts) {
    const earnedMax = new Map<string, number>()
    for (const e of earned) {
      const prev = earnedMax.get(e.badge_id) ?? 0
      if (e.tier > prev) earnedMax.set(e.badge_id, e.tier)
    }
    const lockedCandidates: Array<{ def: typeof BADGE_CATALOG[number]; pct: number; current: number; threshold: number; tierNum: 1 | 2 | 3 | 4 }> = []
    for (const def of BADGE_CATALOG) {
      if (def.isSingleTier) continue
      const earnedTier = earnedMax.get(def.id) ?? 0
      const nextTier = def.tiers.find(t => t.tier === earnedTier + 1)
      if (!nextTier) continue
      const current = countForBadge(def, counts)
      if (current <= 0) continue
      const pct = current / nextTier.threshold
      if (pct >= 1) continue
      lockedCandidates.push({ def, pct, current, threshold: nextTier.threshold, tierNum: nextTier.tier as 1 | 2 | 3 | 4 })
    }
    lockedCandidates.sort((a, b) => b.pct - a.pct)
    for (const c of lockedCandidates.slice(0, 2)) {
      const key = `${c.def.id}:locked`
      if (seen.has(key)) continue
      out.push({
        badgeId: c.def.id,
        label: c.def.name,
        svgIcon: c.def.svgIcon,
        tier: null,
        progress: `${c.current} / ${c.threshold}`,
        progressColor: TIER_META[c.tierNum].color,
      })
      seen.add(key)
    }
  }

  // 3. Backfill from BADGE_CATALOG order so we always have 5 tiles
  for (const def of BADGE_CATALOG) {
    if (out.length >= TARGET) break
    const key = `${def.id}:locked`
    if (seen.has(key)) continue
    // Also skip if we already have an earned tile for this badge
    if ([...seen].some(s => s.startsWith(`${def.id}:`))) continue
    out.push({
      badgeId: def.id,
      label: def.name,
      svgIcon: def.svgIcon,
      tier: null,
    })
    seen.add(key)
  }

  return out.slice(0, TARGET)
}

function countForBadge(def: typeof BADGE_CATALOG[number], counts: Counts): number {
  const t = def.evalType
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
  return 0
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
```
Expected: no errors.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```
Visit `/profile`. Expected: horizontal scrollable row of 5 tiles under the stats strip. Earned badges show tier colors; locked ones show the lock dim state. Users with partial progress on a tiered badge see a small "`3 / 10`" line under the tile. Stop the dev server.

- [ ] **Step 4: Commit**

```
feat(profile): add latest achievements horizontal strip
```

---

## Task 11: Progress card (next achievement)

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

- [ ] **Step 1: Render `<ProgressCard>` under `<LatestAchievementsStrip>`**

After the `<LatestAchievementsStrip .../>` call, add:

```tsx
      {counts && (() => {
        const next = selectNextAchievement(earnedBadges, counts)
        if (!next) return null
        return (
          <ProgressCard
            next={next}
            nextUpLabel={t('nextUp')}
            progressLabel={t('progressOf', { current: next.current, total: next.threshold })}
          />
        )
      })()}
```

- [ ] **Step 2: Append the component at the bottom of the file**

```tsx
// ── ProgressCard ─────────────────────────────────────────────────

interface ProgressCardProps {
  next: ReturnType<typeof selectNextAchievement> & {}
  nextUpLabel: string
  progressLabel: string
}

function ProgressCard({ next, nextUpLabel, progressLabel }: ProgressCardProps) {
  if (!next) return null
  const tierMeta = TIER_META[next.tierNum]
  const pctInt = Math.round(next.pct * 100)

  return (
    <div style={{
      background: V3.BG_CARD,
      clipPath: V3.clip.card,
      borderLeft: `3px solid ${tierMeta.color}`,
      padding: '12px 14px',
      margin: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <BadgeIcon svgIcon={next.badge.svgIcon} tier={null} size={48} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 9, fontWeight: 800, letterSpacing: 1,
          textTransform: 'uppercase', color: tierMeta.color,
        }}>
          {nextUpLabel}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2 }}>
          {next.badge.name} · {tierMeta.label}
        </div>
        <div style={{
          height: 5, width: '100%',
          background: 'rgba(255,255,255,0.08)',
          clipPath: V3.clip.badge,
          marginTop: 8,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            width: `${pctInt}%`, height: '100%',
            background: tierMeta.color,
          }} />
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginTop: 4, fontSize: 10, fontWeight: 700, color: V3.MUTED,
        }}>
          <span>{progressLabel}</span>
          <span>{pctInt}%</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + smoke test**

```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
npm run dev
```
Visit `/profile`. Expected: for a user with at least one partially-progressed tiered badge, the progress card renders between the latest-achievements strip and the (not-yet-rendered) CTA. For a user with no progress, no card appears.

Stop the dev server.

- [ ] **Step 4: Commit**

```
feat(profile): add next-achievement progress card
```

---

## Task 12: Achievements CTA banner

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

- [ ] **Step 1: Render `<AchievementsCTA>` under the progress card**

Add directly after the progress-card IIFE:

```tsx
      <AchievementsCTA
        earnedCount={new Set(earnedBadges.map(b => b.badge_id)).size}
        totalTierSlots={totalTierSlots()}
        earnedTierPairs={earnedBadges.length}
        ctaTitle={t('seeAllAchievements')}
        onClick={() => router.push('/achievements')}
        summaryTemplate={(args) => t('achievementsSummary', args)}
        allTiersEarnedLabel={t('allTiersEarned')}
      />
```

- [ ] **Step 2: Append component and helper at the bottom of the file**

```tsx
// ── AchievementsCTA ──────────────────────────────────────────────

function totalTierSlots(): number {
  // Single-tier badges contribute 1 slot; tiered badges contribute tiers.length.
  let sum = 0
  for (const def of BADGE_CATALOG) {
    sum += def.isSingleTier ? 1 : def.tiers.length
  }
  return sum
}

interface AchievementsCTAProps {
  earnedCount: number
  totalTierSlots: number
  earnedTierPairs: number
  ctaTitle: string
  onClick: () => void
  summaryTemplate: (args: { earned: number; togo: number }) => string
  allTiersEarnedLabel: string
}

function AchievementsCTA({
  earnedCount, totalTierSlots, earnedTierPairs,
  ctaTitle, onClick, summaryTemplate, allTiersEarnedLabel,
}: AchievementsCTAProps) {
  const togo = Math.max(0, totalTierSlots - earnedTierPairs)
  const allEarned = togo === 0
  const borderColor = allEarned ? '#FFD166' : V3.GREEN
  const overallTier = overallTierFromBadgeCount(earnedCount)

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 'calc(100% - 32px)',
        margin: '0 16px 18px',
        background: V3.BG_CARD,
        clipPath: V3.clip.card,
        borderLeft: `3px solid ${borderColor}`,
        border: 'none',
        borderTop: 'none', borderRight: 'none', borderBottom: 'none',
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', color: 'inherit',
      }}
    >
      <BadgeIcon svgIcon="trophy" tier={overallTier} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
          {ctaTitle}
        </div>
        <div style={{ fontSize: 11, color: V3.MUTED, marginTop: 2 }}>
          {allEarned
            ? allTiersEarnedLabel
            : summaryTemplate({ earned: earnedCount, togo })}
        </div>
      </div>
      <ChevronRightIcon size={18} color={V3.MUTED} />
    </button>
  )
}
```

Note: `borderLeft: \`3px solid ${borderColor}\`` followed by `border: 'none'` looks redundant; the intent is to override the full-border shorthand `button` defaults while keeping the left accent. Rewrite cleanly:

Replace the style block inside the button with:

```tsx
      style={{
        width: 'calc(100% - 32px)',
        margin: '0 16px 18px',
        background: V3.BG_CARD,
        clipPath: V3.clip.card,
        border: 'none',
        borderLeft: `3px solid ${borderColor}`,
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', color: 'inherit',
      }}
```

- [ ] **Step 3: Typecheck + smoke test**

```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
npm run dev
```
Visit `/profile`. Expected: banner with trophy icon + "See all achievements" title + summary subline + right chevron. Tapping navigates to `/achievements`. Stop the dev server.

- [ ] **Step 4: Commit**

```
feat(profile): add see-all-achievements cta banner
```

---

## Task 13: Activity section (three deep-link rows)

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx`

- [ ] **Step 1: Render `<ActivitySection>` under the CTA**

Add directly after the `<AchievementsCTA .../>` call:

```tsx
      <ActivitySection
        header={t('activity.header')}
        onRowClick={(href) => router.push(href)}
        rows={[
          {
            key: 'matches',
            href: '/following?tab=matches',
            icon: 'bookmark',
            label: t('activity.matches'),
            sub: t('activity.matchesSub'),
            count: counts?.matchBookmarkCount ?? null,
          },
          {
            key: 'players',
            href: '/following?tab=players',
            icon: 'search',
            label: t('activity.players'),
            sub: t('activity.playersSub'),
            count: counts?.playerFollowCount ?? null,
          },
          {
            key: 'notifications',
            href: '/notifications',
            icon: 'bell',
            label: t('activity.notifications'),
            sub: t('activity.notificationsSub'),
            count: getUnreadNotificationCount(),
            isAlert: true,
          },
        ]}
      />
```

- [ ] **Step 2: Append the component at the bottom of the file**

```tsx
// ── ActivitySection ──────────────────────────────────────────────

type ActivityIconKey = 'bookmark' | 'search' | 'bell'

interface ActivityRow {
  key: string
  href: string
  icon: ActivityIconKey
  label: string
  sub: string
  count: number | null
  isAlert?: boolean  // renders count chip in red when count > 0
}

interface ActivitySectionProps {
  header: string
  rows: ActivityRow[]
  onRowClick: (href: string) => void
}

function ActivitySection({ header, rows, onRowClick }: ActivitySectionProps) {
  return (
    <div>
      <div style={{
        color: V3.ORANGE, fontSize: 11, fontWeight: 700,
        letterSpacing: 1, textTransform: 'uppercase',
        padding: '0 16px', marginBottom: 10,
      }}>
        {header}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map(row => (
          <button
            key={row.key}
            type="button"
            onClick={() => onRowClick(row.href)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderTop: `1px solid ${V3.BORDER}`,
              cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit', color: 'inherit',
              width: '100%',
            }}
          >
            <ActivityIcon icon={row.icon} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                {row.label}
              </div>
              <div style={{ color: V3.MUTED, fontSize: 11, marginTop: 2 }}>
                {row.sub}
              </div>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 700,
              padding: '2px 8px',
              clipPath: V3.clip.badge,
              background: row.isAlert && (row.count ?? 0) > 0
                ? 'rgba(255,70,85,0.12)'
                : 'rgba(255,255,255,0.05)',
              color: row.isAlert && (row.count ?? 0) > 0
                ? V3.LIVE_RED
                : '#fff',
            }}>
              {row.count === null ? '—' : row.count}
            </div>
            <ChevronRightIcon size={16} color={V3.MUTED} />
          </button>
        ))}
      </div>
    </div>
  )
}

function ActivityIcon({ icon }: { icon: ActivityIconKey }) {
  const Inner = icon === 'bookmark' ? BookmarkIcon : icon === 'search' ? SearchIcon : BellIcon
  return (
    <div style={{
      width: 32, height: 32,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      clipPath: V3.clip.chunky,
      background: 'rgba(126,211,33,0.08)',
      border: `1.5px solid rgba(126,211,33,0.4)`,
      flexShrink: 0,
    }}>
      <Inner size={16} color={V3.GREEN} />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + smoke test**

```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
npm run dev
```
Visit `/profile`. Expected: ACTIVITY header followed by three full-width rows — Bookmarked matches, Followed players, Notifications. Tapping "Bookmarked matches" pushes `/following?tab=matches`; tapping "Notifications" pushes `/notifications` (which 404s until Phase 3, acceptable).

Stop the dev server.

- [ ] **Step 4: Commit**

```
feat(profile): add activity section with three deep-link rows
```

---

## Task 14: Lint, typecheck, and final cleanup

**Files:**
- Modify: `src/app/[locale]/(app)/profile/page.tsx` (only if issues surface)

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit --project /Users/GuDenes/Projects/padel-live-scores/tsconfig.json
```
Expected: no errors. Fix any that appeared.

- [ ] **Step 2: Lint**

```bash
npm run lint
```
Expected: no new warnings/errors attributable to the rewrite. Common cleanup:
- Unused imports left over from the old file (`Spinner`, `CountryPicker`, `useInvite`, `AmbassadorBadge`, `LocaleSwitcher`, `usePushNotifications`, `Link`) — remove any still present.
- Unused state variables — remove.

If lint flags issues in the file you wrote, fix them in-place and re-run.

- [ ] **Step 3: Re-run unit tests**

```bash
npx vitest run src/lib/__tests__/gamification.test.ts
```
Expected: all green.

- [ ] **Step 4: Manual verification matrix**

Run the dev server and visit `/profile` while signed in. Verify each of the following states renders correctly (toggle by signing in as accounts at different progress levels, or temporarily stub counts for a quick check):

| State | Expected |
|---|---|
| 0 badges, streak 0 | No tier chip, no streak chip, no progress card. CTA still renders. |
| 3 badges, streak 7 | Tier chip "TIER 1 · ROOKIE". Streak chip "7-day streak". Progress card shows closest tier-2 chase. |
| All badges earned | CTA subline = "All tiers earned", border-left gold. No progress card. |
| Counts still loading | Stats strip shows "—" where numbers go. No progress card. |

Stop the dev server.

- [ ] **Step 5: Commit if any fixes were needed**

```
fix(profile): lint + unused-imports cleanup after rewrite
```

If no fixes were needed, skip this commit.

---

## Self-review checklist

- Every task names the exact files it touches. ✓
- Every code block is paste-ready — no `...`, no "similar to above". ✓
- Tests for `computeXp`, `formatXp`, and `selectNextAchievement` are fully spelled out, with fixtures and expected values. ✓
- The icon set task comes before any task that imports it. ✓
- `gamification.ts` is created before the profile page consumes it. ✓
- i18n keys added in English before other locales; all five locale files updated before the page renders translated strings (Task 9 is the first task that uses any of the new string keys beyond `t('profile')` / `t('settings')` from Task 7, and by then Tasks 5–6 have populated every locale). ✓
- Every `router.push(...)` target is either an existing route (`/home`, `/achievements`, `/following`, `/profile/settings`) or an acknowledged 404 (`/notifications` + `/profile/settings` if Phase 1 ships late — both called out in the spec). ✓
- No data migrations; every count uses an existing table/column. ✓
- Branch + commit messages follow the project's conventional-commit style (`feat(profile)`, `feat(icons)`, `test:`, `fix(profile)`). ✓
- Total task count: 14. Each task targets one logical commit. ✓
