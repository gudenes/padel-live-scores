'use client'
// src/components/AuthProvider.tsx
// Provides auth state (user, profile, session, loading, signOut) to the app via React context.
// Listens to Supabase onAuthStateChange for real-time session updates.
// On first sign-in, migrates localStorage bookmarks to Supabase.

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { startSessionKeepalive, refreshSessionIfNeeded } from '@/lib/supabase-health'
import type { User, Session } from '@supabase/supabase-js'

interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  preferred_country: string | null
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
  /** Bumped on TOKEN_REFRESHED so pages can auto-refetch when the
   *  session recovers from a wedge. Include in useEffect deps to
   *  trigger a refetch without depending on user reference identity. */
  retryKey: number
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  retryKey: 0,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

const BOOKMARKS_STORAGE_KEY = 'pn_bookmarked_matches'
const FOLLOWING_STORAGE_KEY = 'pn_following'

interface FollowingData {
  matches?: string[]
  players?: string[]
  tournaments?: string[]
  news_sources?: string[]
}

async function migrateLocalBookmarks(userId: string) {
  // --- Old format migration: pn_bookmarked_matches ---
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY)
    if (raw) {
      const ids: string[] = JSON.parse(raw)
      if (ids.length) {
        const rows = ids.map(id => ({
          user_id: userId,
          bookmark_type: 'match' as const,
          target_id: id,
        }))
        const { error } = await supabase
          .from('user_bookmarks')
          .upsert(rows, { onConflict: 'user_id,bookmark_type,target_id' })
        if (!error) {
          localStorage.removeItem(BOOKMARKS_STORAGE_KEY)
          console.log(`[Auth] Migrated ${ids.length} legacy bookmarks to Supabase`)
        } else {
          console.warn('[Auth] Legacy bookmark migration error:', error)
        }
      }
    }
  } catch (e) {
    console.warn('[Auth] Legacy bookmark migration failed:', e)
  }

  // --- New format migration: pn_following ---
  try {
    const raw = localStorage.getItem(FOLLOWING_STORAGE_KEY)
    if (!raw) return
    const following: FollowingData = JSON.parse(raw)

    const rows: { user_id: string; bookmark_type: string; target_id: string }[] = []

    for (const id of following.matches ?? []) {
      rows.push({ user_id: userId, bookmark_type: 'match', target_id: id })
    }
    for (const id of following.players ?? []) {
      rows.push({ user_id: userId, bookmark_type: 'player', target_id: id })
    }
    for (const id of following.tournaments ?? []) {
      rows.push({ user_id: userId, bookmark_type: 'tournament', target_id: id })
    }

    if (rows.length) {
      const { error } = await supabase
        .from('user_bookmarks')
        .upsert(rows, { onConflict: 'user_id,bookmark_type,target_id' })
      if (error) {
        console.warn('[Auth] Following migration error:', error)
        return
      }
      console.log(`[Auth] Migrated ${rows.length} follows to Supabase`)
    }

    // Keep only news_sources in localStorage — they have no UUID target_id
    const kept: FollowingData = { news_sources: following.news_sources ?? [] }
    localStorage.setItem(FOLLOWING_STORAGE_KEY, JSON.stringify(kept))
  } catch (e) {
    console.warn('[Auth] Following migration failed:', e)
  }
}

async function migrateLocalRatings(accessToken: string) {
  try {
    const { readAllRatings, RATINGS_KEY, DEVICE_ID_KEY } = await import('@/hooks/useMatchRating')
    const ratings = readAllRatings()
    const entries = Object.entries(ratings)
    if (!entries.length) return

    const deviceId = localStorage.getItem(DEVICE_ID_KEY)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    }

    const results = await Promise.allSettled(
      entries.map(([matchId, rating]) =>
        fetch('/api/match-rating', {
          method: 'POST',
          headers,
          body: JSON.stringify({ matchId, rating, deviceId }),
        })
      )
    )

    const allOk = results.every(r => r.status === 'fulfilled' && (r.value as Response).ok)
    if (allOk) {
      localStorage.removeItem(RATINGS_KEY)
      console.log(`[Auth] Migrated ${entries.length} ratings to Supabase`)
    }
  } catch (e) {
    console.error('[Auth] Rating migration failed:', e)
  }
}

async function claimReferral(userId: string) {
  if (typeof document === 'undefined') return

  // Read cookie
  const match = document.cookie.match(/(?:^|;\s*)pn_invite_ref=([A-Z0-9]{6})/)
  if (!match) return
  const code = match[1]

  try {
    // Resolve inviter
    const { data: inviter } = await supabase
      .from('profiles')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle()

    if (!inviter) return
    if (inviter.id === userId) {
      // Self-referral — just clear the cookie
      document.cookie = 'pn_invite_ref=; Path=/; Max-Age=0; SameSite=lax'
      return
    }

    // Only set referred_by if currently null (idempotent)
    const { error } = await supabase
      .from('profiles')
      .update({ referred_by: inviter.id })
      .eq('id', userId)
      .is('referred_by', null)

    if (!error) {
      document.cookie = 'pn_invite_ref=; Path=/; Max-Age=0; SameSite=lax'
      console.log('[Auth] Claimed referral from', code)
    }
  } catch (e) {
    console.warn('[Auth] claimReferral failed:', e)
  }
}

async function updateLoginStreak(userId: string) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('last_active_at, login_streak, longest_streak')
      .eq('id', userId)
      .single()

    if (!profile) return

    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const lastActive = profile.last_active_at
      ? new Date(profile.last_active_at).toISOString().slice(0, 10)
      : null

    if (lastActive === today) return // Already updated today

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    const newStreak = lastActive === yesterdayStr
      ? (profile.login_streak ?? 0) + 1
      : 1

    const newLongest = Math.max(newStreak, profile.longest_streak ?? 0)

    await supabase
      .from('profiles')
      .update({
        last_active_at: now.toISOString(),
        login_streak: newStreak,
        longest_streak: newLongest,
      })
      .eq('id', userId)
  } catch (e) {
    console.warn('[Auth] updateLoginStreak failed:', (e as Error)?.message)
  }
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, preferred_country')
      .eq('id', userId)
      .single()
    if (error) return null
    return data
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    // Safety timeout — if getSession() hangs (known Supabase lock deadlock),
    // unblock the UI after 3s. The auth state change listener will still
    // pick up the session whenever it eventually resolves.
    const safetyTimeout = setTimeout(() => {
      if (!cancelled) {
        console.warn('[Auth] getSession() timed out after 3s — unblocking UI')
        setLoading(false)
      }
    }, 3000)

    // Get initial session (don't block on profile fetch)
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return
      clearTimeout(safetyTimeout)
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
      // Profile fetch in background — never blocks loading state
      if (s?.user) {
        fetchProfile(s.user.id).then(p => { if (!cancelled) setProfile(p) }).catch(() => {})
        void updateLoginStreak(s.user.id)
      }
      // If the persisted session is close to expiry (e.g. user reopened a
      // tab that's been idle for hours), refresh it proactively in the
      // background so the next query has a fresh token.
      if (s) {
        void refreshSessionIfNeeded('mount')
      }
    }).catch(err => {
      console.error('[Auth] getSession() failed:', err)
      if (!cancelled) {
        clearTimeout(safetyTimeout)
        setLoading(false)
      }
    })

    // Listen for auth changes — log every event with timestamps so we can
    // diagnose wedge issues from console history.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        const ts = new Date().toISOString()
        console.log(`[Auth] ${ts} event=${event} hasSession=${!!s} userId=${s?.user?.id?.slice(0, 8) ?? '-'}`)
        if (cancelled) return
        setSession(s)
        setUser(s?.user ?? null)
        setLoading(false) // ensure loading is false once we get any auth event

        // Bump retryKey so pages auto-refetch when the session recovers
        // from a wedge (e.g. after a hung getSession finally resolves).
        if (event === 'TOKEN_REFRESHED') {
          setRetryKey(k => k + 1)
        }

        if (s?.user) {
          const p = await fetchProfile(s.user.id)
          if (cancelled) return
          setProfile(p)

          // Update login streak (fire-and-forget)
          void updateLoginStreak(s.user.id)

          // Migrate localStorage bookmarks on first sign-in
          if (event === 'SIGNED_IN') {
            await migrateLocalBookmarks(s.user.id)
            void claimReferral(s.user.id)
            if (s.access_token) {
              await migrateLocalRatings(s.access_token)
            }
          }
        } else {
          setProfile(null)
        }
      }
    )

    // Periodic session keepalive — pings supabase.auth.getSession every
    // 5 minutes to keep the client warm and detect wedges before the next
    // user interaction. Only runs in the browser.
    const stopKeepalive = startSessionKeepalive()

    return () => {
      cancelled = true
      clearTimeout(safetyTimeout)
      subscription.unsubscribe()
      stopKeepalive()
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setSession(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, retryKey, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
