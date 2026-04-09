// src/lib/badges.ts
//
// Badge catalog for the PadelNachos gamification system.
// 18 badges across 5 categories with padel-themed tier progression:
// Rookie → Intermediate → Advanced → Padel Genius

// ── Tier system ──────────────────────────────────────────────────

export const TIER_META = {
  1: { label: 'Rookie',       color: '#7ED321' },
  2: { label: 'Intermediate', color: '#F5A623' },
  3: { label: 'Advanced',     color: '#FF6B2B' },
  4: { label: 'Padel Genius', color: '#FFD166' },
} as const

export type TierNumber = 1 | 2 | 3 | 4

export type BadgeCategory =
  | 'getting_started'
  | 'following'
  | 'engagement'
  | 'consistency'

export type EvalType =
  | 'bookmark_count'   // COUNT user_bookmarks WHERE bookmark_type = evalParam
  | 'rating_count'     // COUNT match_ratings
  | 'activity_count'   // COUNT user_activity_log WHERE action = evalParam
  | 'login_streak'     // profiles.login_streak
  | 'longest_streak'   // profiles.longest_streak
  | 'referral_count'   // COUNT profiles WHERE referred_by = userId
  | 'profile_complete' // check profiles fields
  | 'early_adopter'    // check profiles.created_at
  | 'feature_interest' // check feature_interest table
  | 'push_enabled'     // check push_subscriptions

export interface BadgeTier {
  tier: TierNumber
  threshold: number
}

export interface BadgeDefinition {
  id: string
  name: string
  description: string
  svgIcon: string           // icon identifier for BadgeIcon component
  category: BadgeCategory
  categoryLabel: string
  tiers: BadgeTier[]        // empty for single-tier badges
  isSingleTier: boolean
  evalType: EvalType
  evalParam?: string        // e.g. 'player' for bookmark_count, 'article_click' for activity_count
  isPremium?: boolean       // true for special badges with premium visual treatment (glow, gold)
}

// ── Launch date constant ─────────────────────────────────────────
// Founding Member badge: awarded to users who sign up within 30 days of this date.
export const LAUNCH_DATE = new Date('2026-04-15T00:00:00Z')
export const OG_FAN_CUTOFF = new Date(LAUNCH_DATE.getTime() + 30 * 24 * 60 * 60 * 1000)

// ── Badge catalog ────────────────────────────────────────────────

export const BADGE_CATALOG: BadgeDefinition[] = [
  // ── Getting Started ─────────────────────────────────
  {
    id: 'profile_complete',
    name: 'Welcome',
    description: 'Create your PadelNachos account and join the community.',
    svgIcon: 'checkmark',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: true,
    tiers: [],
    evalType: 'profile_complete',
  },
  {
    id: 'early_adopter',
    name: 'Founding Member',
    description: 'Joined PadelNachos within the first 30 days of launch. A rare badge for the originals.',
    svgIcon: 'crown',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: true,
    tiers: [],
    evalType: 'early_adopter',
    isPremium: true,
  },
  {
    id: 'genius_insider',
    name: 'Genius Insider',
    description: 'Signed up for PadelGenius early access.',
    svgIcon: 'lightbulb',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: true,
    tiers: [],
    evalType: 'feature_interest',
    evalParam: 'padel_genius',
  },
  {
    id: 'push_enabled',
    name: 'Always Connected',
    description: 'Enabled push notifications to never miss a match.',
    svgIcon: 'bell',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: true,
    tiers: [],
    evalType: 'push_enabled',
  },

  // ── Following ───────────────────────────────────────
  {
    id: 'follow_players',
    name: 'Scout',
    description: 'Follow your favorite players to track their journey.',
    svgIcon: 'search',
    category: 'following',
    categoryLabel: 'Following',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 1 },
      { tier: 2, threshold: 5 },
      { tier: 3, threshold: 15 },
    ],
    evalType: 'bookmark_count',
    evalParam: 'player',
  },
  {
    id: 'follow_tournaments',
    name: 'Globe Trotter',
    description: 'Follow tournaments around the world.',
    svgIcon: 'globe',
    category: 'following',
    categoryLabel: 'Following',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 1 },
      { tier: 2, threshold: 3 },
      { tier: 3, threshold: 10 },
    ],
    evalType: 'bookmark_count',
    evalParam: 'tournament',
  },
  {
    id: 'follow_matches',
    name: 'Match Tracker',
    description: 'Bookmark matches to keep them on your radar.',
    svgIcon: 'bookmark',
    category: 'following',
    categoryLabel: 'Following',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 1 },
      { tier: 2, threshold: 10 },
      { tier: 3, threshold: 50 },
    ],
    evalType: 'bookmark_count',
    evalParam: 'match',
  },

  // ── Engagement ──────────────────────────────────────
  {
    id: 'rate_matches',
    name: 'Match Critic',
    description: 'Rate matches to help the community find the best ones.',
    svgIcon: 'star',
    category: 'engagement',
    categoryLabel: 'Engagement',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 1 },
      { tier: 2, threshold: 10 },
      { tier: 3, threshold: 50 },
    ],
    evalType: 'rating_count',
  },
  {
    id: 'read_articles',
    name: 'News Junkie',
    description: 'Stay up to date with padel news and stories.',
    svgIcon: 'document',
    category: 'engagement',
    categoryLabel: 'Engagement',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 5 },
      { tier: 2, threshold: 25 },
      { tier: 3, threshold: 100 },
    ],
    evalType: 'activity_count',
    evalParam: 'article_click',
  },
  {
    id: 'watch_videos',
    name: 'Highlight Reel',
    description: 'Watch padel highlights and best moments.',
    svgIcon: 'play',
    category: 'engagement',
    categoryLabel: 'Engagement',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 5 },
      { tier: 2, threshold: 25 },
      { tier: 3, threshold: 100 },
    ],
    evalType: 'activity_count',
    evalParam: 'video_play',
  },
  {
    id: 'share_app',
    name: 'Megaphone',
    description: 'Share PadelNachos with your padel friends.',
    svgIcon: 'share',
    category: 'engagement',
    categoryLabel: 'Engagement',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 1 },
      { tier: 2, threshold: 5 },
      { tier: 3, threshold: 15 },
    ],
    evalType: 'activity_count',
    evalParam: 'share',
  },

  // ── Consistency ─────────────────────────────────────
  {
    id: 'login_streak',
    name: 'Daily Devotee',
    description: 'Visit PadelNachos every day — build the habit!',
    svgIcon: 'flame',
    category: 'consistency',
    categoryLabel: 'Consistency',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 3 },
      { tier: 2, threshold: 7 },
      { tier: 3, threshold: 30 },
      { tier: 4, threshold: 100 },
    ],
    evalType: 'login_streak',
  },
  {
    id: 'longest_streak',
    name: 'Streak Legend',
    description: 'Your all-time best daily visit streak.',
    svgIcon: 'diamond',
    category: 'consistency',
    categoryLabel: 'Consistency',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 7 },
      { tier: 2, threshold: 30 },
      { tier: 3, threshold: 100 },
    ],
    evalType: 'longest_streak',
  },

  // ── Ambassador (in Getting Started) ─────────────────
  {
    id: 'ambassador',
    name: 'Ambassador',
    description: 'Invite friends to PadelNachos and grow the community.',
    svgIcon: 'bolt',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: false,
    tiers: [
      { tier: 1, threshold: 1 },
      { tier: 2, threshold: 5 },
      { tier: 3, threshold: 15 },
      { tier: 4, threshold: 50 },
    ],
    evalType: 'referral_count',
  },
]

// Lookup helpers
export const BADGE_MAP = Object.fromEntries(
  BADGE_CATALOG.map(b => [b.id, b])
) as Record<string, BadgeDefinition>

export const BADGE_CATEGORIES = [
  { key: 'getting_started', label: 'Getting Started' },
  { key: 'following', label: 'Following' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'consistency', label: 'Consistency' },
] as const

/**
 * Compute the user's overall "level" from their badge count.
 * Matches the padel tier system:
 *   0 badges  → null (no level yet)
 *   1-4       → Rookie
 *   5-9       → Intermediate
 *   10-14     → Advanced
 *   15+       → Padel Genius
 */
export function overallTierFromBadgeCount(count: number): TierNumber | null {
  if (count >= 15) return 4
  if (count >= 10) return 3
  if (count >= 5) return 2
  if (count >= 1) return 1
  return null
}
