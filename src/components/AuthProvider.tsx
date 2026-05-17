'use client'
// src/components/AuthProvider.tsx
// Thin wrapper around Auth.js SessionProvider.
// Provides useAuth() hook for components that need user identity.

import { SessionProvider, useSession } from 'next-auth/react'
import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { initNative } from '@/lib/native-init'
import { persistCachedFcmToken } from '@/lib/persist-fcm-token'
import { supabase } from '@/lib/supabase'

interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  preferred_country: string | null
}

interface AuthContextType {
  user: { id: string; name?: string | null; email?: string | null; image?: string | null } | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

function AuthInner({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()

  // Stable user/profile references: memoize on the id so consumer effects
  // keyed on `user` don't refire on every SessionProvider re-render.
  const userId = session?.user?.id ?? null
  const userName = session?.user?.name ?? null
  const userEmail = session?.user?.email ?? null
  const userImage = session?.user?.image ?? null

  const user = useMemo(
    () => (userId ? { id: userId, name: userName, email: userEmail, image: userImage } : null),
    [userId, userName, userEmail, userImage],
  )

  // Fetch the canonical profile row from Supabase so display_name reflects
  // what's actually stored in the DB (cleared via the createUser event for
  // Apple Hide My Email accounts, and updated when users hit Settings →
  // Edit profile). Without this, AuthProvider was using session.user.name,
  // which Auth.js's Apple provider falls back to the email address when
  // no real name is shared — rendering e.g. "5tdwb8r94t@privaterelay..."
  // in the profile menu.
  const [dbProfile, setDbProfile] = useState<{ display_name: string | null; avatar_url: string | null; preferred_country: string | null } | null>(null)

  useEffect(() => {
    if (!userId) {
      setDbProfile(null)
      return
    }
    let alive = true
    void supabase
      .from('profiles')
      .select('display_name, avatar_url, preferred_country')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!alive || !data) return
        setDbProfile({
          display_name: data.display_name,
          avatar_url: data.avatar_url,
          preferred_country: data.preferred_country,
        })
      })
    return () => { alive = false }
  }, [userId])

  // Push token re-registration on sign-in. native-init.ts runs at app
  // boot and tries to POST the FCM token to the backend — but at boot
  // time the auth session usually hasn't loaded yet, so the POST hits
  // 401 and the token never lands in the DB. Once the session resolves
  // (userId becomes non-null), we re-POST from the cache. The endpoint
  // upserts on (user_id, device_token) so a second POST is a no-op
  // when the boot-time POST happened to succeed.
  useEffect(() => {
    if (!userId) return
    void persistCachedFcmToken()
  }, [userId])

  // Sanitize email-shaped session names defensively — even if dbProfile
  // hasn't loaded yet, we never want to flash the relay email as the
  // user's "name" in the UI.
  const sessionName = userName && userName.includes('@') ? null : userName

  const profile = useMemo<Profile | null>(
    () => (user ? {
      id: user.id,
      display_name: dbProfile?.display_name ?? sessionName,
      avatar_url: dbProfile?.avatar_url ?? user.image ?? null,
      preferred_country: dbProfile?.preferred_country ?? null,
    } : null),
    [user, dbProfile, sessionName],
  )

  const signOut = useCallback(async () => {
    const { signOut: doSignOut } = await import('next-auth/react')
    await doSignOut({ redirect: false })
  }, [])

  const contextValue = useMemo(
    () => ({ user, profile, loading: status === 'loading', signOut }),
    [user, profile, status, signOut],
  )

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialize Capacitor native plugins (no-op on web).
  useEffect(() => { void initNative() }, [])

  return (
    <SessionProvider
      refetchInterval={0}
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
    >
      <AuthInner>{children}</AuthInner>
    </SessionProvider>
  )
}
