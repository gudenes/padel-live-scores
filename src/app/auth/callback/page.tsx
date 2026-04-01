'use client'
// src/app/auth/callback/page.tsx
// Handles OAuth and magic link redirects.
// The Supabase client (detectSessionInUrl + PKCE) automatically exchanges
// the ?code= param for a session. We just wait for the auth state to
// update, then redirect home.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_IN') {
          router.replace('/v2')
        }
      }
    )

    // Fallback: if already signed in or if auto-detection already ran
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/v2')
      }
    })

    // Safety timeout — if nothing happens after 5s, redirect with error
    const timeout = setTimeout(() => {
      router.replace('/v2?auth_error=1')
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [router])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', color: 'var(--text-muted)', fontSize: 14,
    }}>
      Signing in...
    </div>
  )
}
