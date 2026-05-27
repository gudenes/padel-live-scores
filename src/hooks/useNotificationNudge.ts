'use client'
// src/hooks/useNotificationNudge.ts
//
// Decides whether to show the bookmark/follow nudge after a user takes the
// triggering action. Pure logic (testable) lives at the top; the React hook
// wraps it with context access at the bottom.

import { useCallback, useContext } from 'react'
import { NotificationNudgeContext } from '@/components/NotificationNudgeProvider'

export type NudgeCategory = 'match_live_bookmark' | 'match_live_follow'
export type NudgeState = 'os-blocked' | 'master-off' | 'pref-off'

export interface NudgeContext {
  osPermission: NotificationPermission // 'granted' | 'denied' | 'default'
  pushEnabled: boolean                  // master push subscription state (web push subscription OR native FCM token registered)
  categoryPushPref: boolean             // user's current push pref for the category
  now: number                           // injectable for tests
  storage: Storage                      // injectable for tests
}

const DISMISSAL_WINDOW_MS = 7 * 24 * 3600 * 1000

function dismissalKey(category: NudgeCategory): string {
  return `pn:nudge-dismissed:${category}`
}

/**
 * Pure decision function. Returns the nudge state to show, or null to skip.
 *
 * Priority order (most severe → most granular):
 *   os-blocked  — OS perm denied. Can't fix from inside the app, need to
 *                 deep-link to system settings.
 *   master-off  — OS perm OK, but the master push toggle is off (no active
 *                 web push subscription / no FCM token). User can re-enable
 *                 with one tap → triggers togglePush().
 *   pref-off    — OS perm OK + master is on, but THIS specific category is
 *                 disabled. One PATCH to flip it back on.
 *   null        — fully configured OR dismissed in the last 7 days.
 */
export function shouldShowNudge(category: NudgeCategory, ctx: NudgeContext): NudgeState | null {
  // Dismissal first — short-circuit before any other logic
  const dismissedAt = ctx.storage.getItem(dismissalKey(category))
  if (dismissedAt) {
    const elapsed = ctx.now - parseInt(dismissedAt, 10)
    if (elapsed < DISMISSAL_WINDOW_MS) return null
  }

  // OS blocked is most severe
  if (ctx.osPermission === 'denied') return 'os-blocked'

  // Master toggle off — push subscription doesn't exist
  if (!ctx.pushEnabled) return 'master-off'

  // Per-category pref disabled
  if (!ctx.categoryPushPref) return 'pref-off'

  return null
}

export function recordDismissal(category: NudgeCategory, now: number, storage: Storage): void {
  storage.setItem(dismissalKey(category), String(now))
}

// ── React hook ─────────────────────────────────────────────────────
//
// The provider is mounted in (app)/layout.tsx. Hook subscribers (e.g. the
// MatchCard bookmark click handler) call triggerNudge() to publish a
// candidate; the provider runs shouldShowNudge() with current OS perm +
// stored prefs and either shows the sheet or no-ops.

export interface UseNotificationNudgeResult {
  triggerNudge: (args: { category: NudgeCategory }) => void
}

export function useNotificationNudge(): UseNotificationNudgeResult {
  const ctx = useContext(NotificationNudgeContext)
  const triggerNudge = useCallback((args: { category: NudgeCategory }) => {
    ctx.publish(args.category)
  }, [ctx])
  return { triggerNudge }
}
