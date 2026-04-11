'use client'
// src/components/LoginSheet.tsx
// Bottom sheet for sign-in: Google OAuth + magic link email fallback.
// Slides up from bottom with dimmed backdrop. V3 brand styling.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase, siteUrl } from '@/lib/supabase'

// ── V3 Brand constants ────────────────────────────────────────
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

const CLIP = {
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

interface LoginSheetProps {
  open: boolean
  onClose: () => void
}

interface PendingReferral {
  code: string
  inviterName: string | null
  inviterAvatar: string | null
}

export default function LoginSheet({ open, onClose }: LoginSheetProps) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRef, setPendingRef] = useState<PendingReferral | null>(null)

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Read pending referral from localStorage
  useEffect(() => {
    if (!open) return
    try {
      const raw = localStorage.getItem('pn_pending_referral')
      if (raw) setPendingRef(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [open])

  if (!open || !mounted) return null

  const handleGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
      },
    })
    if (error) setError('Sign in failed, please try again')
  }

  const handleMagicLink = async () => {
    if (!email.trim()) return
    setSending(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    })

    setSending(false)
    if (error) {
      setError('Failed to send link, please try again')
    } else {
      setSent(true)
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: BG_CARD,
          clipPath: 'polygon(0% 3%, 100% 0%, 100% 100%, 0% 100%)',
          padding: '32px 20px 100px',
          borderTop: `2px solid ${GREEN}`,
          animation: 'loginSlideUp 0.3s ease-out',
        }}
      >
        {/* Drag handle */}
        <div style={{
          width: 36, height: 4, background: 'rgba(255,255,255,0.12)',
          borderRadius: 2, margin: '0 auto 24px',
        }} />

        {/* Pending referral invite — shown when user arrived via ref link */}
        {pendingRef && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px', marginBottom: 20,
            background: 'rgba(126,211,33,0.06)',
            border: `1px solid rgba(126,211,33,0.15)`,
            clipPath: CLIP.card,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              border: `2px solid rgba(126,211,33,0.3)`,
              background: pendingRef.inviterAvatar
                ? `url(${pendingRef.inviterAvatar}) center/cover`
                : 'linear-gradient(135deg, #3a4a5a, #2a3a4a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {!pendingRef.inviterAvatar && (
                <span style={{ fontSize: 14, fontWeight: 800, color: GREEN }}>
                  {(pendingRef.inviterName || '?')[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                {(pendingRef.inviterName?.split(' ')[0]) || 'Someone'} invited you
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
                Sign in to join PadelNachos
              </div>
            </div>
            <div style={{
              width: 6, height: 6, background: GREEN, flexShrink: 0,
              clipPath: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
            }} />
          </div>
        )}

        <div style={{ textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
          {pendingRef ? 'Sign in to get started' : 'Sign in to Padel Nachos'}
        </div>
        <div style={{ textAlign: 'center', color: MUTED, fontSize: 12, marginBottom: 28 }}>
          {pendingRef ? 'Live scores, rankings & match alerts await' : 'Sync bookmarks & get match notifications'}
        </div>

        {sent ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0' }}>
            <div style={{
              width: 56, height: 56,
              background: 'rgba(126, 211, 33, 0.12)',
              clipPath: CLIP.button,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter">
                <path d="M2 4h20v16H2z" />
                <polyline points="22,4 12,13 2,4" />
              </svg>
            </div>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              Check your email
            </div>
            <div style={{ color: MUTED, fontSize: 12 }}>
              We sent a sign-in link to {email}
            </div>
          </div>
        ) : (
          <>
            {/* Google button */}
            <button
              onClick={handleGoogle}
              style={{
                width: '100%', background: '#fff', color: '#1a1a1a',
                clipPath: CLIP.button,
                padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none',
                fontFamily: 'inherit',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
              <div style={{ flex: 1, height: 1, background: BORDER }} />
              <div style={{ color: MUTED, fontSize: 11, fontWeight: 600, letterSpacing: '0.5px' }}>or</div>
              <div style={{ flex: 1, height: 1, background: BORDER }} />
            </div>

            {/* Magic link email */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleMagicLink()}
                style={{
                  flex: 1, background: BG_BASE,
                  border: `1px solid ${BORDER}`,
                  clipPath: CLIP.button,
                  padding: '12px 14px', color: '#fff', fontSize: 13,
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={handleMagicLink}
                disabled={sending || !email.trim()}
                style={{
                  background: GREEN, color: '#000',
                  clipPath: CLIP.button,
                  padding: '12px 16px', fontWeight: 700, fontSize: 13,
                  whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
                  fontFamily: 'inherit',
                  opacity: sending || !email.trim() ? 0.5 : 1,
                }}
              >
                {sending ? 'Sending...' : 'Send link'}
              </button>
            </div>

            <div style={{ textAlign: 'center', color: MUTED, fontSize: 10, marginTop: 14 }}>
              We&apos;ll email you a sign-in link — no password needed
            </div>

            {error && (
              <div style={{ textAlign: 'center', color: '#FF4655', fontSize: 12, fontWeight: 600, marginTop: 8 }}>{error}</div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes loginSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  )
}
