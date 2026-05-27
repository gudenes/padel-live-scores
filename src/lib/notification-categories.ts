// src/lib/notification-categories.ts
//
// Single source of truth for notification categories. Used by:
//   - /api/push/notify  (writer — resolves per-user prefs before fanout)
//   - /api/notifications  (read/filter)
//   - /api/user/notification-prefs  (validation + GET resolver)
//   - /profile/settings/notifications  (UI render)
//   - /notifications  (filter pill → category IN list)
//
// 2026-05-27 changes:
//   - Dropped match_upcoming, badge_earned, streak_milestone (never fired).
//   - Added ranking_updated (weekly FIP rankings refresh).
//   - ChannelPrefs simplified from { push, inApp } to { push } only. In-app
//     delivery is always-on now; the inbox is benign and configurable
//     channel-by-channel was needless cognitive load. Existing stored
//     `inApp` keys in profiles.notification_prefs JSONB become orphans
//     this resolver silently drops — no SQL migration needed.

export type ChannelPrefs = { push: boolean }

export type NotificationCategory =
  | 'match_live_follow'
  | 'match_live_bookmark'
  | 'match_finished'
  | 'ranking_updated'
  | 'marketing'

export const CATEGORY_DEFAULTS: Record<NotificationCategory, ChannelPrefs> = {
  match_live_follow:   { push: true },
  match_live_bookmark: { push: true },
  match_finished:      { push: true },
  ranking_updated:     { push: true },  // weekly cadence, low-frequency, fine to default on
  marketing:           { push: true },  // opt-out model (2026-05-27 decision)
}

export const KNOWN_CATEGORIES = Object.keys(CATEGORY_DEFAULTS) as NotificationCategory[]

export function isKnownCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (KNOWN_CATEGORIES as string[]).includes(value)
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
      return ['match_live_follow', 'match_live_bookmark', 'match_finished']
    case 'updates':
      return ['ranking_updated', 'marketing']
    default:
      return []
  }
}
