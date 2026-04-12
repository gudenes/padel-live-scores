'use client'
// src/hooks/useBadges.ts
//
// Badge state + evaluation engine. Fetches earned badges, checks
// thresholds, and inserts newly earned tiers via Supabase RLS.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  BADGE_CATALOG, BADGE_MAP,
} from '@/lib/badges'
import { getBadgeCount } from '@/lib/badge-eval'

export interface EarnedBadge {
  badge_id: string
  tier: number
  unlocked_at: string
}

export interface UseBadgesResult {
  badges: EarnedBadge[]
  loading: boolean
  /** Check a specific badge against a count and award new tiers. */
  checkAndAward: (badgeId: string) => Promise<EarnedBadge[]>
  /** Evaluate ALL badges for the current user (lazy batch). */
  evaluateAll: () => Promise<EarnedBadge[]>
  /** Refresh the badge list from DB. */
  refresh: () => Promise<void>
}

export function useBadges(): UseBadgesResult {
  const { user, loading: authLoading } = useAuth()
  const [badges, setBadges] = useState<EarnedBadge[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBadges = useCallback(async () => {
    if (!user) { setBadges([]); setLoading(false); return }
    const { data } = await supabase
      .from('user_badges')
      .select('badge_id, tier, unlocked_at')
      .eq('user_id', user.id)
    setBadges(data ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    ;(async () => {
      if (!user) { if (!cancelled) { setBadges([]); setLoading(false) }; return }
      const { data } = await supabase
        .from('user_badges')
        .select('badge_id, tier, unlocked_at')
        .eq('user_id', user.id)
      if (!cancelled) {
        setBadges(data ?? [])
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [authLoading, user])

  /** Check one badge and award any newly earned tiers. */
  const checkAndAward = useCallback(async (badgeId: string): Promise<EarnedBadge[]> => {
    if (!user) return []
    const badge = BADGE_MAP[badgeId]
    if (!badge) return []

    const count = await getBadgeCount(user.id, badge)
    const alreadyEarned = new Set(
      badges.filter(b => b.badge_id === badgeId).map(b => b.tier)
    )

    const newBadges: EarnedBadge[] = []

    if (badge.isSingleTier) {
      if (count >= 1 && !alreadyEarned.has(1)) {
        const { error } = await supabase
          .from('user_badges')
          .insert({ user_id: user.id, badge_id: badgeId, tier: 1 })
        if (!error) {
          const earned: EarnedBadge = { badge_id: badgeId, tier: 1, unlocked_at: new Date().toISOString() }
          newBadges.push(earned)
        }
      }
    } else {
      for (const t of badge.tiers) {
        if (count >= t.threshold && !alreadyEarned.has(t.tier)) {
          const { error } = await supabase
            .from('user_badges')
            .insert({ user_id: user.id, badge_id: badgeId, tier: t.tier })
          if (!error) {
            newBadges.push({ badge_id: badgeId, tier: t.tier, unlocked_at: new Date().toISOString() })
          }
        }
      }
    }

    if (newBadges.length > 0) {
      setBadges(prev => [...prev, ...newBadges])
    }
    return newBadges
  }, [user, badges])

  /** Evaluate all badges at once (lazy batch). */
  const evaluateAll = useCallback(async (): Promise<EarnedBadge[]> => {
    const allNew: EarnedBadge[] = []
    for (const badge of BADGE_CATALOG) {
      const earned = await checkAndAward(badge.id)
      allNew.push(...earned)
    }
    return allNew
  }, [checkAndAward])

  return {
    badges,
    loading,
    checkAndAward,
    evaluateAll,
    refresh: fetchBadges,
  }
}
