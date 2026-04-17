'use client'
// src/components/AuthProvider.tsx
// Thin wrapper around Auth.js SessionProvider.
// Provides useAuth() hook for components that need user identity.

import { SessionProvider, useSession } from 'next-auth/react'
import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react'

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

  const profile = useMemo<Profile | null>(
    () => (user ? { id: user.id, display_name: user.name ?? null, avatar_url: user.image ?? null, preferred_country: null } : null),
    [user],
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
