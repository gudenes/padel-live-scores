'use client'
// src/components/AuthProvider.tsx
// Provides auth state (user, profile, session, loading, signOut) to the app via React context.
// Listens to Supabase onAuthStateChange for real-time session updates.
// On first sign-in, migrates localStorage bookmarks to Supabase.

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  loading: true,
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

async function fetchProfile(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
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
      }
    }).catch(err => {
      console.error('[Auth] getSession() failed:', err)
      if (!cancelled) {
        clearTimeout(safetyTimeout)
        setLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        if (cancelled) return
        setSession(s)
        setUser(s?.user ?? null)
        setLoading(false) // ensure loading is false once we get any auth event

        if (s?.user) {
          const p = await fetchProfile(s.user.id)
          if (cancelled) return
          setProfile(p)

          // Migrate localStorage bookmarks on first sign-in
          if (event === 'SIGNED_IN') {
            await migrateLocalBookmarks(s.user.id)
            if (s.access_token) {
              await migrateLocalRatings(s.access_token)
            }
          }
        } else {
          setProfile(null)
        }
      }
    )

    return () => {
      cancelled = true
      clearTimeout(safetyTimeout)
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setSession(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
