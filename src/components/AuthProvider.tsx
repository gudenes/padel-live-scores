'use client'
// src/components/AuthProvider.tsx
// Thin wrapper around Auth.js SessionProvider.
// Provides useAuth() hook for components that need user identity.

import { SessionProvider, useSession } from 'next-auth/react'
import { createContext, useContext, useCallback, type ReactNode } from 'react'

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

  const user = session?.user
    ? {
        id: session.user.id!,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : null

  const signOut = useCallback(async () => {
    const { signOut: doSignOut } = await import('next-auth/react')
    await doSignOut({ redirect: false })
  }, [])

  // Derive a profile from session data so existing consumers (profile page,
  // header, etc.) work without changes. The profile page can later fetch
  // richer data from /api/user/profile if needed.
  const profile: Profile | null = user
    ? {
        id: user.id,
        display_name: user.name ?? null,
        avatar_url: user.image ?? null,
        preferred_country: null,
      }
    : null

  return (
    <AuthContext.Provider value={{ user, profile, loading: status === 'loading', signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthInner>{children}</AuthInner>
    </SessionProvider>
  )
}
