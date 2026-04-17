'use client'
// src/components/PadelGeniusTeaser.tsx
//
// "Coming soon" teaser for the PadelGenius daily quiz feature.
// Logged out → "Sign in to get notified" → opens login sheet
// Logged in, not opted-in → "Notify Me →" → inserts feature_interest row
// Logged in, already opted-in → "✓ You'll be notified" disabled

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useLoginSheet } from '@/components/LoginSheetProvider'
import { useTranslations } from 'next-intl'

const FEATURE_KEY = 'padel_genius'

const ORANGE = '#F5A623'
const GREEN = '#7ED321'
const MUTED = '#6B7280'
const BG_CARD = '#141414'

const CHUNKY = {
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

export default function PadelGeniusTeaser() {
  const { user, loading: authLoading } = useAuth()
  const t = useTranslations('genius')

  const [optedIn, setOptedIn] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { openLoginSheet } = useLoginSheet()

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

    if (!user) {
      openLoginSheet()
      return
    }

    if (optedIn) return

    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('feature_interest')
        .insert({ user_id: user.id, feature_key: FEATURE_KEY })
      if (error) {
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

  const buttonLabel = !user
    ? t('signInToGetNotified')
    : optedIn
      ? `✓ ${t('youllBeNotified')}`
      : submitting
        ? t('saving')
        : `${t('notifyMe')} →`

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

      <div style={{
        fontSize: 18, fontWeight: 800, color: '#fff',
        marginBottom: 4, letterSpacing: '-0.3px', position: 'relative',
      }}>
        PadelGenius
      </div>

      <div style={{
        fontSize: 10, color: ORANGE, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: 1.5,
        marginBottom: 12, position: 'relative',
      }}>
        {t('comingSoon')}
      </div>

      <div style={{
        fontSize: 12, color: MUTED, marginBottom: 18,
        lineHeight: 1.5, maxWidth: 280, margin: '0 auto 18px', position: 'relative',
        whiteSpace: 'pre-line',
      }}>
        {t('description')}
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={buttonDisabled}
        style={{
          display: 'inline-block', padding: '11px 28px',
          background: optedIn ? 'rgba(126,211,33,0.15)' : ORANGE,
          color: optedIn ? GREEN : '#000',
          fontSize: 12, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: 0.5, clipPath: CHUNKY.button,
          cursor: buttonDisabled ? 'default' : 'pointer',
          border: 'none', fontFamily: 'inherit',
          opacity: submitting ? 0.7 : 1,
          transition: 'opacity 0.15s',
          position: 'relative',
        }}
      >
        {buttonLabel}
      </button>
    </div>
  )
}
