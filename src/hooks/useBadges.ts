'use client'
// src/hooks/useBadges.ts
// Badge state hook — fetches earned badges via API route.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'

export interface EarnedBadge {
  badge_id: string
  tier: number
  unlocked_at: string
}

export interface UseBadgesResult {
  badges: EarnedBadge[]
  loading: boolean
  checkAndAward: (badgeId: string) => Promise<EarnedBadge[]>
  evaluateAll: () => Promise<EarnedBadge[]>
  refresh: () => Promise<void>
}

export function useBadges(): UseBadgesResult {
  const { user, loading: authLoading } = useAuth()
  const [badges, setBadges] = useState<EarnedBadge[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBadges = useCallback(async (checkUnlocks = false) => {
    if (!user) { setBadges([]); setLoading(false); return [] }
    const url = checkUnlocks ? '/api/user/badges?check_unlocks=true' : '/api/user/badges'
    const res = await fetch(url)
    if (!res.ok) { setLoading(false); return [] }
    const data = await res.json()
    const list = checkUnlocks ? data.badges : data
    setBadges(list ?? [])
    setLoading(false)
    return checkUnlocks ? (data.newBadges ?? []) : []
  }, [user])

  useEffect(() => {
    if (authLoading) return
    void fetchBadges()
  }, [authLoading, fetchBadges])

  const checkAndAward = useCallback(async (_badgeId: string): Promise<EarnedBadge[]> => {
    return fetchBadges(true)
  }, [fetchBadges])

  const evaluateAll = useCallback(async (): Promise<EarnedBadge[]> => {
    return fetchBadges(true)
  }, [fetchBadges])

  return { badges, loading, checkAndAward, evaluateAll, refresh: () => fetchBadges() }
}
