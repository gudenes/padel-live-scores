'use client'
// src/hooks/useBadges.ts
//
// Badge state + evaluation engine. Fetches earned badges, checks
// thresholds, and inserts newly earned tiers via Supabase RLS.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  BADGE_CATALOG, BADGE_MAP, OG_FAN_CUTOFF,
  type BadgeDefinition,
} from '@/lib/badges'

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

  /** Get the current count for a badge's eval type. */
  const getCount = useCallback(async (badge: BadgeDefinition): Promise<number> => {
    if (!user) return 0

    switch (badge.evalType) {
      case 'bookmark_count': {
        const { count } = await supabase
          .from('user_bookmarks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('bookmark_type', badge.evalParam ?? '')
        return count ?? 0
      }
      case 'rating_count': {
        const { count } = await supabase
          .from('match_ratings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
        return count ?? 0
      }
      case 'activity_count': {
        const { count } = await supabase
          .from('user_activity_log')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('action', badge.evalParam ?? '')
        return count ?? 0
      }
      case 'login_streak': {
        const { data } = await supabase
          .from('profiles')
          .select('login_streak')
          .eq('id', user.id)
          .single()
        return data?.login_streak ?? 0
      }
      case 'longest_streak': {
        const { data } = await supabase
          .from('profiles')
          .select('longest_streak')
          .eq('id', user.id)
          .single()
        return data?.longest_streak ?? 0
      }
      case 'referral_count': {
        const { count } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('referred_by', user.id)
        return count ?? 0
      }
      case 'profile_complete': {
        const { data } = await supabase
          .from('profiles')
          .select('display_name, avatar_url, preferred_country')
          .eq('id', user.id)
          .single()
        return (data?.display_name && data?.avatar_url && data?.preferred_country) ? 1 : 0
      }
      case 'early_adopter': {
        const { data } = await supabase
          .from('profiles')
          .select('created_at')
          .eq('id', user.id)
          .single()
        if (!data?.created_at) return 0
        return new Date(data.created_at) < OG_FAN_CUTOFF ? 1 : 0
      }
      case 'feature_interest': {
        const { count } = await supabase
          .from('feature_interest')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('feature_key', badge.evalParam ?? '')
        return (count ?? 0) > 0 ? 1 : 0
      }
      case 'push_enabled': {
        const { count } = await supabase
          .from('push_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
        return (count ?? 0) > 0 ? 1 : 0
      }
      default:
        return 0
    }
  }, [user])

  /** Check one badge and award any newly earned tiers. */
  const checkAndAward = useCallback(async (badgeId: string): Promise<EarnedBadge[]> => {
    if (!user) return []
    const badge = BADGE_MAP[badgeId]
    if (!badge) return []

    const count = await getCount(badge)
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
  }, [user, badges, getCount])

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
