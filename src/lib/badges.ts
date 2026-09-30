// src/lib/badges.ts
//
// Badge catalog for the PadelNachos gamification system.
// Nine active collectibles, with retired badges preserved for existing owners.
// Original tier progression remains:
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
  | 'prediction'
  | 'getting_started'
  | 'following'
  | 'engagement'
  | 'consistency'

export type EvalType =
  | 'prediction_count'
  | 'prediction_wins'
  | 'prediction_streak'
  | 'prediction_tournament'
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

const ORIGINAL_CATALOG: BadgeDefinition[] = [
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

// Keep old IDs and tiers intact so previously earned badges remain available.
const retained: Record<string, string> = {
  follow_players: 'scout', follow_matches: 'match-tracker', rate_matches: 'match-critic',
  early_adopter: 'founding-member', ambassador: 'ambassador',
}
export const LEGACY_BADGES = ORIGINAL_CATALOG.filter(b => !retained[b.id])
export const BADGE_CATALOG: BadgeDefinition[] = [
  { id: 'first_pick', name: 'First Pick', description: 'Complete your first settled prediction. Voided markets do not count.', svgIcon: 'first-pick', category: 'prediction', categoryLabel: 'Predictions', isSingleTier: false, tiers: [{tier: 1, threshold: 1}], evalType: 'prediction_count' },
  { id: 'king_of_predict', name: 'King of Predict', description: 'Finish 25 markets with a Guacas profit. Each settled market counts once.', svgIcon: 'king-of-predict', category: 'prediction', categoryLabel: 'Predictions', isSingleTier: false, tiers: [{tier: 1, threshold: 25}], evalType: 'prediction_wins', isPremium: true },
  { id: 'on_fire', name: 'On Fire', description: 'Finish 5 markets in a row with a Guacas profit, in settlement order. Voided markets are skipped.', svgIcon: 'on-fire', category: 'prediction', categoryLabel: 'Predictions', isSingleTier: false, tiers: [{tier: 1, threshold: 5}], evalType: 'prediction_streak' },
  { id: 'tournament_brain', name: 'Tournament Brain', description: 'Finish 10 markets in the same tournament with a Guacas profit.', svgIcon: 'tournament-brain', category: 'prediction', categoryLabel: 'Predictions', isSingleTier: false, tiers: [{tier: 1, threshold: 10}], evalType: 'prediction_tournament' },
  ...Object.entries(retained).map(([id, svgIcon]) => ({...ORIGINAL_CATALOG.find(b => b.id === id)!, svgIcon})),
]
export const BADGE_MAP = Object.fromEntries([...BADGE_CATALOG, ...LEGACY_BADGES].map(b => [b.id,b])) as Record<string, BadgeDefinition>
export const BADGE_CATEGORIES = [
  { key: 'prediction', label: 'Predictions' },
  { key: 'following', label: 'Following' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'getting_started', label: 'Community' },
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
