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
          router.replace('/v3')
        }
      }
    )

    // Fallback: if already signed in or if auto-detection already ran
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/v3')
      }
    })

    // Safety timeout — if nothing happens after 5s, redirect with error
    const timeout = setTimeout(() => {
      router.replace('/v3?auth_error=1')
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [router])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#0A0A0A', gap: 12,
    }}>
      <span style={{
        width: 20, height: 20,
        border: '2px solid #7ED321', borderTopColor: 'transparent',
        borderRadius: '50%', display: 'inline-block',
        animation: 'authSpin 0.6s linear infinite',
      }} />
      <span style={{ color: '#6B7280', fontSize: 14, fontWeight: 600 }}>Signing in...</span>
      <style>{`@keyframes authSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
