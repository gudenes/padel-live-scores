'use client'
// src/app/auth/callback/page.tsx
// Handles OAuth and magic link redirects.
// Exchanges the ?code= param for a session, then redirects to /v3.
// Uses polling + auth listener + URL code exchange to handle all timing scenarios.

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const HINTS = [
  'Loading your profile...',
  'Syncing your bookmarks...',
  'Preparing your feed...',
  'Almost there...',
  'Setting up your experience...',
  'Connecting to live scores...',
]

export default function AuthCallback() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [hintIdx, setHintIdx] = useState(0)
  const [redirected, setRedirected] = useState(false)

  const doRedirect = () => {
    if (redirected) return
    setRedirected(true)
    router.replace('/v3')
  }

  useEffect(() => {
    // 1. Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          doRedirect()
        }
      }
    )

    // 2. Try to exchange the code from URL params (PKCE flow)
    const code = searchParams.get('code')
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (data?.session) {
          doRedirect()
        } else if (error) {
          console.warn('[Auth callback] Code exchange failed:', error.message)
        }
      })
    }

    // 3. Poll for session (handles race conditions)
    const poll = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) doRedirect()
    }, 500)

    // 4. Safety timeout — redirect anyway after 8s
    const timeout = setTimeout(() => {
      console.warn('[Auth callback] Timeout — redirecting')
      doRedirect()
    }, 8000)

    return () => {
      subscription.unsubscribe()
      clearInterval(poll)
      clearTimeout(timeout)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rotate hint text
  useEffect(() => {
    const interval = setInterval(() => {
      setHintIdx(i => (i + 1) % HINTS.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#1A1A1A', gap: 20,
    }}>
      {/* Animated logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/padelnachos-logo-v2.png"
        alt="PadelNachos"
        style={{
          height: 56,
          objectFit: 'contain',
          animation: 'authPulse 1.8s ease-in-out infinite',
        }}
      />

      {/* Rotating hint text */}
      <div style={{ height: 20, overflow: 'hidden', position: 'relative', minWidth: 200, textAlign: 'center' }}>
        <span
          key={hintIdx}
          style={{
            color: '#6B7280',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.3,
            animation: 'authFadeSlide 2s ease-in-out',
            display: 'inline-block',
          }}
        >
          {HINTS[hintIdx]}
        </span>
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#7ED321',
              animation: `authDot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes authPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
        @keyframes authFadeSlide {
          0% { opacity: 0; transform: translateY(8px); }
          15% { opacity: 1; transform: translateY(0); }
          85% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-8px); }
        }
        @keyframes authDot {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.4); }
        }
      `}</style>
    </div>
  )
}
