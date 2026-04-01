'use client'
// src/app/auth/callback/page.tsx
// Handles OAuth and magic link redirects — exchanges code for session.
// Must be client-side so the Supabase client has access to the PKCE
// code_verifier stored in the browser during the OAuth initiation.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('[Auth Callback] Error exchanging code:', error.message)
          router.replace('/v2?auth_error=1')
          return
        }
      }

      // Redirect to home after successful auth
      router.replace('/v2')
    }

    handleCallback()
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
