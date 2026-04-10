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

  // Fetch inviter profile + persist to localStorage for post-signup toast
  useEffect(() => {
    if (!refCode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInviter(null)
      return
    }
    let cancelled = false
    void resolveInviterByCode(refCode).then(data => {
      if (!cancelled) {
        setInviter(data)
        // Persist inviter info so the post-signup toast can show it
        // even if the user signs up later (cookie handles the claim,
        // localStorage handles the notification)
        if (data && typeof window !== 'undefined') {
          try {
            localStorage.setItem('pn_pending_referral', JSON.stringify({
              code: refCode,
              inviterName: data.display_name,
              inviterAvatar: data.avatar_url,
            }))
          } catch { /* quota / private browsing — ignore */ }
        }
      }
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

  const firstName = (inviter.display_name?.trim() || 'Someone').split(' ')[0]

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
          animation: 'invite-backdrop-fade 0.3s ease-out forwards',
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
        background: BG_CARD,
      }}>
        {/* ── Accent bar (orange → green gradient) ────────── */}
        <div style={{
          height: 3,
          background: 'linear-gradient(90deg, #F5A623, #7ED321)',
        }} />

        {/* ── Header: centered logo + close button ────────── */}
        <div className="invite-stagger invite-stagger-1" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px 18px 0', position: 'relative',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/padelnachos-logo-v2.png"
            alt="PadelNachos"
            style={{ height: 42, objectFit: 'contain' }}
          />
          <button
            onClick={handleDismiss}
            aria-label="Dismiss"
            style={{
              position: 'absolute', top: 14, right: 16,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={MUTED} strokeWidth="1.8" strokeLinecap="round">
              <line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" />
            </svg>
          </button>
        </div>

        {/* ── Welcome label ───────────────────────────────── */}
        <div className="invite-stagger invite-stagger-2" style={{
          textAlign: 'center', marginTop: 20,
          fontSize: 11, fontWeight: 500,
          letterSpacing: 1.5, textTransform: 'uppercase',
          color: MUTED,
        }}>
          Welcome to the world of padel
        </div>

        {/* ── Avatar with green glow ──────────────────────── */}
        <div className="invite-stagger invite-stagger-3" style={{
          display: 'flex', justifyContent: 'center', marginTop: 18, position: 'relative',
        }}>
          <div style={{ position: 'relative', width: 64, height: 64 }}>
            {/* Glow */}
            <div style={{
              position: 'absolute', inset: -6,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(126,211,33,0.15) 0%, transparent 70%)',
            }} />
            {/* Ring */}
            <div style={{
              position: 'absolute', inset: -3,
              borderRadius: '50%',
              border: '1.5px solid rgba(126,211,33,0.3)',
            }} />
            {/* Avatar */}
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: inviter.avatar_url
                ? `url(${inviter.avatar_url}) center/cover`
                : 'linear-gradient(135deg, #3a4a5a, #2a3a4a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {!inviter.avatar_url && (
                <span style={{ fontSize: 20, fontWeight: 800, color: GREEN }}>
                  {firstName[0]?.toUpperCase() ?? '?'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Inviter subtitle ────────────────────────────── */}
        <div className="invite-stagger invite-stagger-4" style={{
          textAlign: 'center', marginTop: 14,
          fontSize: 13, color: MUTED,
        }}>
          <span style={{ color: '#ccc', fontWeight: 600 }}>{firstName}</span> invited you to PadelNachos
        </div>

        {/* ── Divider ─────────────────────────────────────── */}
        <div className="invite-stagger invite-stagger-5" style={{
          width: 'calc(100% - 48px)', height: 1, margin: '18px auto 16px',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08) 20%, rgba(255,255,255,0.08) 80%, transparent)',
        }} />

        {/* ── Value props with SVG icons ───────────────────── */}
        <div className="invite-stagger invite-stagger-6" style={{
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: '0 22px',
        }}>
          {/* Live scores */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 28, height: 28, flexShrink: 0,
              clipPath: CHUNKY_BADGE, background: 'rgba(126,211,33,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="4" width="18" height="14" stroke={GREEN} strokeWidth="1.5" />
                <line x1="2" y1="10" x2="20" y2="10" stroke={GREEN} strokeWidth="1" opacity="0.5" />
                <line x1="11" y1="4" x2="11" y2="18" stroke={GREEN} strokeWidth="1" opacity="0.5" />
                <circle cx="11" cy="10" r="1.5" fill={GREEN} />
              </svg>
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#aaa' }}>Live scores, point by point</span>
          </div>

          {/* Rankings */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 28, height: 28, flexShrink: 0,
              clipPath: CHUNKY_BADGE, background: 'rgba(245,166,35,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
                <rect x="3" y="10" width="4" height="8" fill="#F5A623" opacity="0.7" />
                <rect x="9" y="5" width="4" height="13" fill="#F5A623" />
                <rect x="15" y="8" width="4" height="10" fill="#F5A623" opacity="0.5" />
              </svg>
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#aaa' }}>Rankings and up to date stats</span>
          </div>

          {/* Alerts */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 28, height: 28, flexShrink: 0,
              clipPath: CHUNKY_BADGE, background: 'rgba(126,211,33,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
                <path d="M11 3 C11 3 6 6 6 11 L6 14 L4 16 L18 16 L16 14 L16 11 C16 6 11 3 11 3Z" stroke={GREEN} strokeWidth="1.5" fill="none" />
                <circle cx="11" cy="19" r="1.5" fill={GREEN} />
                <circle cx="16" cy="5" r="2.5" fill="#F5A623" />
              </svg>
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#aaa' }}>Your centre court, in your pocket</span>
          </div>
        </div>

        {/* ── CTA button ──────────────────────────────────── */}
        <div style={{ padding: '20px 22px 0' }}>
          <button
            className="invite-stagger invite-stagger-7"
            onClick={handleDismiss}
            style={{
              width: '100%', padding: 14,
              background: '#F5A623', color: '#000',
              fontSize: 14, fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: 0.5,
              border: 'none', clipPath: CHUNKY_BUTTON,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
            }}
          >
            LET&apos;S GO
          </button>
        </div>

        {/* ── Dismiss ─────────────────────────────────────── */}
        <div
          className="invite-stagger invite-stagger-8"
          onClick={handleDismiss}
          style={{
            textAlign: 'center', padding: '12px 0 20px',
            fontSize: 11, color: '#555', cursor: 'pointer',
          }}
        >
          Maybe later
        </div>
      </div>

      {/* Animations — staggered entrance for each element */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes invite-popup-appear {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes invite-fade-up {
          0% { opacity: 0; transform: translateY(12px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes invite-backdrop-fade {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .invite-stagger {
          opacity: 0;
          animation: invite-fade-up 0.4s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
        }
        .invite-stagger-1 { animation-delay: 0.15s; }
        .invite-stagger-2 { animation-delay: 0.25s; }
        .invite-stagger-3 { animation-delay: 0.35s; }
        .invite-stagger-4 { animation-delay: 0.45s; }
        .invite-stagger-5 { animation-delay: 0.55s; }
        .invite-stagger-6 { animation-delay: 0.65s; }
        .invite-stagger-7 { animation-delay: 0.75s; }
        .invite-stagger-8 { animation-delay: 0.85s; }
      `}} />
    </>
  )
}
