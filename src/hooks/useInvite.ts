// src/hooks/useInvite.ts
//
// Invite state + share trigger for the current user. Lazily ensures
// the user has a referral code on first use, computes the shareable
// URL, loads the current invite count + ambassador tier, and exposes
// shareNow() that calls the Web Share API (or falls back to clipboard).

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { ensureReferralCode, countReferralsByUser } from '@/lib/referral'
import { tierForCount, AmbassadorTierSpec } from '@/lib/ambassador'
import { logActivity } from '@/lib/activity-log'

const SHARE_TITLE = 'PadelNachos'
const SHARE_TEXT = 'Follow live padel scores on PadelNachos 🎾'

export interface UseInviteResult {
  inviteUrl: string | null
  inviteCount: number
  tier: AmbassadorTierSpec | null
  loading: boolean
  shareNow: () => Promise<{ ok: boolean; fallback: 'clipboard' | 'native' | null }>
}

export function useInvite(): UseInviteResult {
  const { user, loading: authLoading } = useAuth()
  const [code, setCode] = useState<string | null>(null)
  const [inviteCount, setInviteCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)

  // Load code + count whenever the user changes
  useEffect(() => {
    async function load() {
      if (authLoading) return

      if (!user) {
        setCode(null)
        setInviteCount(0)
        setLoading(false)
        return
      }

      setLoading(true)
      // Fix 4: Don't let referral lookup block the page. If it times out
      // (e.g. on tab wakeup when network is slow), still unblock loading
      // so the profile page and header render. The referral data will
      // arrive on the next successful load.
      try {
        const [c, n] = await Promise.all([
          ensureReferralCode(user.id),
          countReferralsByUser(user.id),
        ])
        setCode(c)
        setInviteCount(n)
      } catch (e) {
        console.warn('[useInvite] load failed (will retry next mount):', (e as Error)?.message)
      }
      setLoading(false)
    }

    void load()

    return () => {}
  }, [user, authLoading])

  const inviteUrl = code && typeof window !== 'undefined'
    ? `${window.location.origin}/home?ref=${code}`
    : null

  const tier = tierForCount(inviteCount)

  const shareNow = useCallback(async (): Promise<{ ok: boolean; fallback: 'clipboard' | 'native' | null }> => {
    if (!inviteUrl) return { ok: false, fallback: null }

    // Prefer native share sheet
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: inviteUrl })
        if (user) void logActivity(user.id, 'share')
        return { ok: true, fallback: 'native' }
      } catch (err) {
        // User cancelled or share failed — fall through to clipboard
        if ((err as Error)?.name === 'AbortError') return { ok: false, fallback: null }
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(inviteUrl)
      if (user) void logActivity(user.id, 'share')
      return { ok: true, fallback: 'clipboard' }
    } catch {
      return { ok: false, fallback: null }
    }
  }, [inviteUrl, user])

  return { inviteUrl, inviteCount, tier, loading, shareNow }
}
