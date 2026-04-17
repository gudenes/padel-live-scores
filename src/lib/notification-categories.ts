// src/lib/notification-categories.ts
//
// Single source of truth for notification categories. Used by:
//   - /api/push/notify  (writer — resolves per-user prefs before fanout)
//   - /api/notifications  (read/filter)
//   - /api/user/notification-prefs  (validation + GET resolver)
//   - /profile/settings/notifications  (UI render)
//   - /notifications  (filter pill → category IN list)
//
// Adding a new category is a one-line change here — no migration needed.

export type ChannelPrefs = { push: boolean; inApp: boolean }

export type NotificationCategory =
  | 'match_live_follow'
  | 'match_live_bookmark'
  | 'match_finished'
  | 'match_upcoming'
  | 'badge_earned'
  | 'streak_milestone'
  | 'marketing'

export const CATEGORY_DEFAULTS: Record<NotificationCategory, ChannelPrefs> = {
  match_live_follow:   { push: true,  inApp: true  },
  match_live_bookmark: { push: true,  inApp: true  },
  match_finished:      { push: false, inApp: true  },
  match_upcoming:      { push: false, inApp: true  },
  badge_earned:        { push: true,  inApp: true  },
  streak_milestone:    { push: true,  inApp: true  },
  marketing:           { push: false, inApp: false },
}

export const KNOWN_CATEGORIES = Object.keys(CATEGORY_DEFAULTS) as NotificationCategory[]

export function isKnownCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (KNOWN_CATEGORIES as string[]).includes(value)
}

/**
 * Merge a stored JSONB prefs object with the code defaults for a given
 * category. Missing keys (or entire missing category) fall back to
 * defaults; partial overrides ({ push: false }) keep the default inApp.
 *
 * stored is whatever came out of `profiles.notification_prefs` — may be
 * null, {}, or a partial object.
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
    inApp: typeof override.inApp === 'boolean' ? override.inApp : defaults.inApp,
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
  filter: 'all' | 'matches' | 'badges' | string,
): NotificationCategory[] | null {
  switch (filter) {
    case 'all':
      return null
    case 'matches':
      return ['match_live_follow', 'match_live_bookmark', 'match_finished', 'match_upcoming']
    case 'badges':
      return ['badge_earned', 'streak_milestone']
    default:
      return []
  }
}
