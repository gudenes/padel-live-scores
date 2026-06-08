// src/lib/notification-categories.ts
//
// Single source of truth for notification categories. Used by:
//   - /api/push/notify  (writer — resolves per-user prefs + tier gate before fanout)
//   - /api/notifications  (read/filter)
//   - /api/user/notification-prefs  (validation + GET resolver, tier annotation)
//   - /profile/settings/notifications  (UI render — grouped, locked Pro rows)
//
// 2026-06-08: added per-category `tier` (free|pro) + `group`, the full premium
// notification catalog (senders land in later plans), and the delivery gate
// shouldDeliverToRecipient(). Pro categories are withheld entirely (push AND
// in-app inbox) from non-Pro recipients — see premium-notifications spec.

import { type Plan } from '@/lib/entitlements'

export type ChannelPrefs = { push: boolean }

export type NotificationCategory =
  // existing
  | 'match_live_follow'
  | 'match_live_bookmark'
  | 'match_finished'
  | 'ranking_updated'
  | 'marketing'
  // new — free
  | 'match_scheduled'
  | 'player_title_won'
  | 'player_eliminated'
  | 'tournament_starting'
  | 'draw_released'
  | 'player_entered'
  | 'weekly_digest'
  // new — pro
  | 'match_deciding_set'
  | 'match_upset_live'
  | 'next_match_drawn'
  | 'ranking_threshold'
  | 'projection_outperform'
  | 'player_path'
  | 'prematch_prediction'
  | 'daily_oop'
  | 'tournament_wrapup'

export type CategoryGroup = 'matches' | 'results' | 'tournaments' | 'predictions'
export const CATEGORY_GROUPS: CategoryGroup[] = ['matches', 'results', 'tournaments', 'predictions']

export type Tier = 'free' | 'pro'

export type CategoryMeta = {
  defaults: ChannelPrefs
  tier: Tier
  group: CategoryGroup
  // `comingSoon: true` = no sender emits this category yet (Plans 2–4 wire them).
  // The settings UI shows a "Soon" pill so users aren't promised an alert that
  // can't fire. Flip to false (or drop the flag) when a category's sender ships.
  comingSoon: boolean
}

// Order within this record = render order within each group.
// Only match live/finished have real senders today → comingSoon: false.
export const CATEGORY_META: Record<NotificationCategory, CategoryMeta> = {
  // ── Matches ──
  match_live_follow:    { defaults: { push: true }, tier: 'free', group: 'matches',      comingSoon: false },
  match_live_bookmark:  { defaults: { push: true }, tier: 'free', group: 'matches',      comingSoon: false },
  match_finished:       { defaults: { push: true }, tier: 'free', group: 'matches',      comingSoon: false },
  match_scheduled:      { defaults: { push: true }, tier: 'free', group: 'matches',      comingSoon: true },
  match_deciding_set:   { defaults: { push: true }, tier: 'pro',  group: 'matches',      comingSoon: true },
  match_upset_live:     { defaults: { push: true }, tier: 'pro',  group: 'matches',      comingSoon: true },
  next_match_drawn:     { defaults: { push: true }, tier: 'pro',  group: 'matches',      comingSoon: true },
  // ── Results & milestones ──
  player_title_won:     { defaults: { push: true }, tier: 'free', group: 'results',      comingSoon: true },
  player_eliminated:    { defaults: { push: true }, tier: 'free', group: 'results',      comingSoon: true },
  ranking_updated:      { defaults: { push: true }, tier: 'free', group: 'results',      comingSoon: true },
  ranking_threshold:    { defaults: { push: true }, tier: 'pro',  group: 'results',      comingSoon: true },
  projection_outperform:{ defaults: { push: true }, tier: 'pro',  group: 'results',      comingSoon: true },
  // ── Tournaments & draws ──
  tournament_starting:  { defaults: { push: true }, tier: 'free', group: 'tournaments',  comingSoon: false },
  draw_released:        { defaults: { push: true }, tier: 'free', group: 'tournaments',  comingSoon: true },
  player_entered:       { defaults: { push: true }, tier: 'free', group: 'tournaments',  comingSoon: true },
  player_path:          { defaults: { push: true }, tier: 'pro',  group: 'tournaments',  comingSoon: true },
  // ── Predictions & digests ──
  prematch_prediction:  { defaults: { push: true }, tier: 'pro',  group: 'predictions',  comingSoon: true },
  daily_oop:            { defaults: { push: true }, tier: 'pro',  group: 'predictions',  comingSoon: true },
  weekly_digest:        { defaults: { push: true }, tier: 'free', group: 'predictions',  comingSoon: true },
  tournament_wrapup:    { defaults: { push: true }, tier: 'pro',  group: 'predictions',  comingSoon: true },
  marketing:            { defaults: { push: true }, tier: 'free', group: 'predictions',  comingSoon: false },
}

// Derived for backward compat — resolvePrefs() reads this.
export const CATEGORY_DEFAULTS: Record<NotificationCategory, ChannelPrefs> = Object.fromEntries(
  (Object.keys(CATEGORY_META) as NotificationCategory[]).map((k) => [k, CATEGORY_META[k].defaults]),
) as Record<NotificationCategory, ChannelPrefs>

export const KNOWN_CATEGORIES = Object.keys(CATEGORY_META) as NotificationCategory[]

export function isKnownCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (KNOWN_CATEGORIES as string[]).includes(value)
}

export function isProCategory(category: NotificationCategory): boolean {
  return CATEGORY_META[category].tier === 'pro'
}

/** Categories a plan is allowed to receive. Free excludes pro categories. */
export function categoriesForTier(plan: Plan): NotificationCategory[] {
  if (plan === 'pro') return KNOWN_CATEGORIES
  return KNOWN_CATEGORIES.filter((c) => !isProCategory(c))
}

/**
 * The single delivery gate. Pro categories are withheld entirely (push AND
 * in-app inbox) from non-Pro recipients. Free categories always pass.
 */
export function shouldDeliverToRecipient(category: NotificationCategory, recipientIsPro: boolean): boolean {
  if (!isProCategory(category)) return true
  return recipientIsPro
}

/**
 * Merge a stored JSONB prefs object with code defaults for a given category.
 * Missing `push` or missing category entry falls back to defaults. Stored
 * orphan keys (e.g. `inApp` from before 2026-05-27) are silently dropped.
 */
export function resolvePrefs(
  stored: Record<string, Partial<ChannelPrefs>> | null | undefined,
  category: NotificationCategory,
): ChannelPrefs {
  const defaults = CATEGORY_DEFAULTS[category]
  const override = stored?.[category]
  if (!override) return { ...defaults }
  return {
    push: typeof override.push === 'boolean' ? override.push : defaults.push,
  }
}

/** Resolve the whole prefs object (every known category) at once. */
export function resolveAllPrefs(
  stored: Record<string, Partial<ChannelPrefs>> | null | undefined,
): Record<NotificationCategory, ChannelPrefs> {
  const out = {} as Record<NotificationCategory, ChannelPrefs>
  for (const key of KNOWN_CATEGORIES) {
    out[key] = resolvePrefs(stored, key)
  }
  return out
}

/** Filter pill → list of categories. 'all' returns null (= no filter). */
export function categoryFilter(
  filter: 'all' | 'matches' | 'updates' | string,
): NotificationCategory[] | null {
  switch (filter) {
    case 'all':
      return null
    case 'matches':
      return KNOWN_CATEGORIES.filter((c) => CATEGORY_META[c].group === 'matches')
    case 'updates':
      return KNOWN_CATEGORIES.filter((c) => CATEGORY_META[c].group !== 'matches')
    default:
      return []
  }
}
