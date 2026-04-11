'use client'
// src/components/PadelGeniusTeaser.tsx
//
// "Coming soon" teaser for the PadelGenius daily quiz feature, shown
// in the same home-page slot the legacy FantasyTeaser used to occupy.
//
// Behavior:
//   - Logged out          → CTA "Sign in to get notified" → /login?next=/home
//   - Logged in, not opted-in → CTA "Notify Me →" → inserts feature_interest row
//   - Logged in, already opted-in → "✓ You'll be notified" disabled
//
// The opt-in is stored in the `feature_interest` table with feature_key
// = 'padel_genius'. When the real feature ships, query that table to
// push-notify everyone who raised their hand.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import LoginSheet from '@/components/LoginSheet'
import { ORANGE, GREEN, MUTED, BG_CARD, CHUNKY } from '@/lib/theme-colors'

const FEATURE_KEY = 'padel_genius'

export default function PadelGeniusTeaser() {
  const { user, loading: authLoading } = useAuth()

  const [optedIn, setOptedIn] = useState<boolean | null>(null) // null = unknown
  const [submitting, setSubmitting] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)

  // Check if the current user has already opted in
  useEffect(() => {
    let cancelled = false
    if (authLoading) return
    if (!user) {
      setOptedIn(false)
      return
    }
    async function check() {
      const { data, error } = await supabase
        .from('feature_interest')
        .select('id')
        .eq('user_id', user!.id)
        .eq('feature_key', FEATURE_KEY)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        console.warn('[PadelGeniusTeaser] check failed:', error.message)
        setOptedIn(false)
        return
      }
      setOptedIn(!!data)
    }
    void check()
    return () => { cancelled = true }
  }, [user, authLoading])

  const handleClick = useCallback(async () => {
    if (submitting) return

    // Logged out → open the login modal in place (no /login route)
    if (!user) {
      setLoginOpen(true)
      return
    }

    // Already opted in → no-op (button is disabled but defend anyway)
    if (optedIn) return

    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('feature_interest')
        .insert({ user_id: user.id, feature_key: FEATURE_KEY })
      if (error) {
        // Unique constraint violation = already opted in (race), treat as success
        if (error.code === '23505') {
          setOptedIn(true)
          return
        }
        console.warn('[PadelGeniusTeaser] insert failed:', error.message)
        return
      }
      setOptedIn(true)
    } finally {
      setSubmitting(false)
    }
  }, [submitting, user, optedIn])

  // ── Button state ─────────────────────────────────────────────
  const buttonLabel = !user
    ? 'Sign in to get notified'
    : optedIn
      ? "✓ You'll be notified"
      : submitting
        ? 'Saving…'
        : 'Notify Me →'

  const buttonDisabled = !!user && (optedIn === true || submitting || optedIn === null)

  return (
    <div style={{
      margin: '0 16px',
      background: `linear-gradient(135deg, ${BG_CARD} 0%, rgba(126,211,33,0.06) 100%)`,
      border: '1px solid rgba(126,211,33,0.18)',
      clipPath: CHUNKY.card,
      padding: '24px 20px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Soft radial glow in the corner */}
      <div style={{
        position: 'absolute', top: -30, left: -30, width: 120, height: 120,
        background: 'radial-gradient(circle, rgba(126,211,33,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -40, right: -40, width: 140, height: 140,
        background: 'radial-gradient(circle, rgba(245,166,35,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Brain icon */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, position: 'relative' }}>
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke={GREEN}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08 2.5 2.5 0 0 0 4.91.05L12 19.5V4.5Z" />
          <path d="M12 4.5a2.5 2.5 0 0 1 4.96-.46 2.5 2.5 0 0 1 1.98 3 2.5 2.5 0 0 1 1.32 4.24 3 3 0 0 1-.34 5.58 2.5 2.5 0 0 1-2.96 3.08 2.5 2.5 0 0 1-4.91.05L12 19.5V4.5Z" />
        </svg>
      </div>

      {/* Title */}
      <div style={{
        fontSize: 18,
        fontWeight: 800,
        color: '#fff',
        marginBottom: 4,
        letterSpacing: '-0.3px',
        position: 'relative',
      }}>
        PadelGenius
      </div>

      {/* Tagline */}
      <div style={{
        fontSize: 10,
        color: ORANGE,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        marginBottom: 12,
        position: 'relative',
      }}>
        Play · Learn · Win
      </div>

      {/* Description */}
      <div style={{
        fontSize: 12,
        color: MUTED,
        marginBottom: 18,
        lineHeight: 1.5,
        maxWidth: 280,
        margin: '0 auto 18px',
        position: 'relative',
      }}>
        Daily padel tactics quizzes.<br />
        Build streaks, earn badges, become a padel genius.
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={handleClick}
        disabled={buttonDisabled}
        style={{
          display: 'inline-block',
          padding: '11px 28px',
          background: optedIn ? 'rgba(126,211,33,0.15)' : ORANGE,
          color: optedIn ? GREEN : '#000',
          fontSize: 12,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          clipPath: CHUNKY.button,
          cursor: buttonDisabled ? 'default' : 'pointer',
          border: 'none',
          fontFamily: 'inherit',
          opacity: submitting ? 0.7 : 1,
          transition: 'opacity 0.15s',
          position: 'relative',
        }}
      >
        {buttonLabel}
      </button>

      {/* Login modal — opens when an anonymous user taps the CTA */}
      <LoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
