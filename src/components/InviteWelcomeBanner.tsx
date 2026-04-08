// src/components/InviteWelcomeBanner.tsx
//
// Welcome banner shown at the top of /home when a visitor arrives
// via an invite link (?ref=<code>). Fetches the inviter's public
// profile fields, renders a dismissible card. Dismissal is tracked
// per-code in sessionStorage so the same ref doesn't re-show, but
// a different ref shows the banner again.

'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { resolveInviterByCode } from '@/lib/referral'
import { useAuth } from '@/components/AuthProvider'

const GREEN = '#7ED321'
const BG_CARD = '#141414'
const MUTED = '#8a8f98'

const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export function InviteWelcomeBanner() {
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const refCode = searchParams.get('ref')

  const [inviter, setInviter] = useState<{ id: string; display_name: string | null; avatar_url: string | null } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // Read initial dismissal state from sessionStorage
  useEffect(() => {
    if (!refCode || typeof window === 'undefined') return
    const key = `pn_welcome_dismissed_${refCode}`
    const isDismissed = sessionStorage.getItem(key) === '1'
    if (isDismissed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(true)
    }
  }, [refCode])

  // Fetch inviter profile
  useEffect(() => {
    if (!refCode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInviter(null)
      return
    }
    let cancelled = false
    void resolveInviterByCode(refCode).then(data => {
      if (!cancelled) setInviter(data)
    })
    return () => { cancelled = true }
  }, [refCode])

  const handleDismiss = () => {
    if (refCode && typeof window !== 'undefined') {
      sessionStorage.setItem(`pn_welcome_dismissed_${refCode}`, '1')
    }
    setDismissed(true)
  }

  // Don't render when:
  // - No ref code in URL
  // - Inviter lookup failed (bad code / network)
  // - User already dismissed this code
  // - The logged-in user IS the inviter (self-referral)
  if (!refCode || !inviter || dismissed) return null
  if (user && user.id === inviter.id) return null

  const name = inviter.display_name?.trim() || 'Someone'

  return (
    <div style={{
      margin: '12px 16px 8px',
      padding: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: `linear-gradient(135deg, rgba(126,211,33,0.1) 0%, ${BG_CARD} 100%)`,
      clipPath: CHUNKY_CARD,
      borderLeft: `3px solid ${GREEN}`,
      position: 'relative',
    }}>
      {/* Inviter avatar */}
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: `2px solid #0A0A0A`,
        background: inviter.avatar_url
          ? `url(${inviter.avatar_url}) center/cover`
          : 'linear-gradient(135deg, #5a6a7a, #2a3a4a)',
        flexShrink: 0,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 9, fontWeight: 800, color: GREEN,
          textTransform: 'uppercase', letterSpacing: 0.5,
          marginBottom: 3,
        }}>
          🎾 You&apos;ve been invited
        </div>
        <div style={{
          fontSize: 14, fontWeight: 800, color: '#fff',
          lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {name} brought you to PadelNachos
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
          Follow your favorite players, get live scores, and never miss a match.
        </div>
      </div>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss invite welcome"
        style={{
          position: 'absolute',
          top: 8, right: 10,
          background: 'none', border: 'none',
          color: MUTED, fontSize: 18, lineHeight: 1,
          cursor: 'pointer', padding: 0,
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  )
}
