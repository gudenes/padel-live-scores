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
  error: boolean
  checkAndAward: (badgeId: string) => Promise<EarnedBadge[]>
  evaluateAll: () => Promise<EarnedBadge[]>
  refresh: () => Promise<void>
}

export function useBadges(): UseBadgesResult {
  const { user, loading: authLoading } = useAuth()
  const [badges, setBadges] = useState<EarnedBadge[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchBadges = useCallback(async (checkUnlocks = false) => {
    if (!user) { setBadges([]); setLoading(false); return [] }
    const url = checkUnlocks ? '/api/user/badges?check_unlocks=true' : '/api/user/badges'
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      const data = await res.json()
      const list = checkUnlocks ? data.badges : data
      setError(false)
      setBadges(list ?? [])
      setLoading(false)
      return checkUnlocks ? (data.newBadges ?? []) : []
    } catch { setError(true); setLoading(false); return [] }
  }, [user])

  useEffect(() => {
    if (authLoading) return
    void fetchBadges()
  }, [authLoading, fetchBadges])

  const checkAndAward = useCallback(async (_badgeId: string): Promise<EarnedBadge[]> => {
    void _badgeId
    return fetchBadges(true)
  }, [fetchBadges])

  const evaluateAll = useCallback(async (): Promise<EarnedBadge[]> => {
    return fetchBadges(true)
  }, [fetchBadges])

  return { badges, loading, error, checkAndAward, evaluateAll, refresh: () => fetchBadges() }
}
