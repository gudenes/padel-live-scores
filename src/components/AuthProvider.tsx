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

async function migrateLocalBookmarks(userId: string) {
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY)
    if (!raw) return
    const ids: string[] = JSON.parse(raw)
    if (!ids.length) return

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
      console.log(`[Auth] Migrated ${ids.length} bookmarks to Supabase`)
    }
  } catch (e) {
    console.error('[Auth] Bookmark migration failed:', e)
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
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        fetchProfile(s.user.id).then(setProfile)
      }
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        setSession(s)
        setUser(s?.user ?? null)

        if (s?.user) {
          const p = await fetchProfile(s.user.id)
          setProfile(p)

          // Migrate localStorage bookmarks on first sign-in
          if (event === 'SIGNED_IN') {
            await migrateLocalBookmarks(s.user.id)
          }
        } else {
          setProfile(null)
        }
      }
    )

    return () => subscription.unsubscribe()
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
