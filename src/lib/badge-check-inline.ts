// src/lib/badge-check-inline.ts
//
// Fire-and-forget inline badge checker. Call after any user action that might
// unlock a badge tier. Dispatches a DOM CustomEvent so UI components can react
// without needing to be wrapped in the useBadges context.

import { supabase } from '@/lib/supabase'
import { BADGE_MAP } from '@/lib/badges'
import { getBadgeCount } from '@/lib/badge-eval'

export const BADGE_UNLOCK_EVENT = 'pn-badge-unlock'

/**
 * Check whether `badgeId` has any newly earned tiers for `userId`.
 * Inserts new rows into `user_badges` and fires a DOM `pn-badge-unlock` event
 * for each newly unlocked tier.
 *
 * Never throws — all errors are caught and logged as warnings so this cannot
 * block the calling UI flow.
 */
export async function checkBadgeInline(userId: string, badgeId: string): Promise<void> {
  try {
    const badge = BADGE_MAP[badgeId]
    if (!badge) {
      console.warn(`[badge-check-inline] Unknown badge id: "${badgeId}"`)
      return
    }

    const count = await getBadgeCount(userId, badge)

    // Fetch already-earned tiers for this badge
    const { data: earnedRows } = await supabase
      .from('user_badges')
      .select('tier')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)

    const alreadyEarned = new Set((earnedRows ?? []).map(r => r.tier))

    if (badge.isSingleTier) {
      if (count >= 1 && !alreadyEarned.has(1)) {
        const { error } = await supabase
          .from('user_badges')
          .insert({ user_id: userId, badge_id: badgeId, tier: 1 })
        if (!error) {
          window.dispatchEvent(
            new CustomEvent(BADGE_UNLOCK_EVENT, { detail: { badge_id: badgeId, tier: 1 } })
          )
        } else {
          console.warn('[badge-check-inline] Insert error:', error.message)
        }
      }
    } else {
      for (const t of badge.tiers) {
        if (count >= t.threshold && !alreadyEarned.has(t.tier)) {
          const { error } = await supabase
            .from('user_badges')
            .insert({ user_id: userId, badge_id: badgeId, tier: t.tier })
          if (!error) {
            window.dispatchEvent(
              new CustomEvent(BADGE_UNLOCK_EVENT, { detail: { badge_id: badgeId, tier: t.tier } })
            )
          } else {
            console.warn('[badge-check-inline] Insert error:', error.message)
          }
        }
      }
    }
  } catch (err) {
    console.warn('[badge-check-inline] Unexpected error:', err)
  }
}
