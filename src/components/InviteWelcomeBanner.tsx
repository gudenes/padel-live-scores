// src/components/InviteWelcomeBanner.tsx
//
// Full-screen welcome popup shown when a visitor arrives via an
// invite link (?ref=<code>). Fetches the inviter's public profile,
// renders a centered modal with the brand green gradient header,
// PadelNachos logo, inviter avatar + name, value props, and a CTA.
// Dismissal tracked per-code in sessionStorage.

'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { resolveInviterByCode } from '@/lib/referral'
import { useAuth } from '@/components/AuthProvider'

const GREEN = '#7ED321'
const BG_CARD = '#141414'
const MUTED = '#8a8f98'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'
const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

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
    <>
      {/* Backdrop */}
      <div
        onClick={handleDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          zIndex: 9998,
        }}
      />

      {/* Popup card */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        width: 320,
        maxWidth: 'calc(100vw - 40px)',
        clipPath: CHUNKY_CARD,
        animation: 'invite-popup-appear 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        overflow: 'hidden',
      }}>
        {/* ── Green gradient header band ─────────────────── */}
        <div style={{
          background: 'linear-gradient(135deg, #7ED321 0%, #5BA418 60%, #3D7A0F 100%)',
          padding: '24px 24px 20px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Subtle glow accents */}
          <div style={{
            position: 'absolute', top: -30, right: -30,
            width: 120, height: 120,
            background: 'radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', bottom: -20, left: -20,
            width: 80, height: 80,
            background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)',
          }} />

          {/* Close button */}
          <button
            onClick={handleDismiss}
            aria-label="Dismiss"
            style={{
              position: 'absolute',
              top: 10, right: 10,
              width: 28, height: 28,
              background: 'rgba(0,0,0,0.2)',
              clipPath: CHUNKY_BADGE,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 16, cursor: 'pointer',
              border: 'none', zIndex: 2,
              fontFamily: 'inherit', lineHeight: 1,
            }}
          >
            ×
          </button>

          {/* PadelNachos logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/padelnachos-logo-v2.png"
            alt="PadelNachos"
            style={{ height: 36, objectFit: 'contain', marginBottom: 14, position: 'relative', zIndex: 1 }}
          />

          {/* Invite label */}
          <div style={{
            fontSize: 10, fontWeight: 800,
            color: 'rgba(0,0,0,0.45)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 10,
            position: 'relative', zIndex: 1,
          }}>
            🎾 You&apos;ve been invited
          </div>

          {/* Inviter section */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            position: 'relative', zIndex: 1,
          }}>
            <div style={{
              width: 56, height: 56,
              borderRadius: '50%',
              border: '3px solid rgba(255,255,255,0.3)',
              background: inviter.avatar_url
                ? `url(${inviter.avatar_url}) center/cover`
                : 'linear-gradient(135deg, #5a6a7a, #2a3a4a)',
              flexShrink: 0,
              overflow: 'hidden',
            }} />
            <div>
              <div style={{
                fontSize: 18, fontWeight: 900,
                color: '#000', lineHeight: 1.2,
              }}>
                {name}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 600,
                color: 'rgba(0,0,0,0.5)',
                marginTop: 3,
              }}>
                brought you to PadelNachos
              </div>
            </div>
          </div>
        </div>

        {/* ── Dark content area ──────────────────────────── */}
        <div style={{
          background: BG_CARD,
          padding: '20px 24px 24px',
        }}>
          <div style={{
            fontSize: 14, fontWeight: 700,
            color: '#fff', lineHeight: 1.5,
            marginBottom: 16,
          }}>
            Your <span style={{ color: GREEN }}>free pass</span> to the world of padel — live scores, rankings, and never miss a match.
          </div>

          {/* Value props — text only, no icons */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            marginBottom: 20,
          }}>
            {[
              'Real-time live scores for every match',
              'Follow your favorite players & tournaments',
              'Push alerts when your matches go live',
            ].map((text, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{
                  width: 6, height: 6,
                  background: GREEN,
                  clipPath: CHUNKY_BADGE,
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>
                  {text}
                </span>
              </div>
            ))}
          </div>

          {/* CTA button */}
          <button
            onClick={handleDismiss}
            style={{
              width: '100%',
              padding: 14,
              background: GREEN,
              color: '#000',
              fontSize: 14, fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              border: 'none',
              clipPath: CHUNKY_BUTTON,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'center',
            }}
          >
            Get Started 🎾
          </button>

          {/* Dismiss link */}
          <div
            onClick={handleDismiss}
            style={{
              textAlign: 'center',
              marginTop: 12,
              fontSize: 11,
              color: '#555',
              cursor: 'pointer',
            }}
          >
            Maybe later
          </div>
        </div>
      </div>

      {/* Animation */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes invite-popup-appear {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}} />
    </>
  )
}
