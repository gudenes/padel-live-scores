'use client'
// src/components/LoginSheet.tsx
// Bottom sheet for sign-in: Google OAuth + Apple Sign-In + magic link
// email fallback. Slides up from bottom with dimmed backdrop. V3 brand
// styling.
//
// Native iOS path (Capacitor): uses @capacitor-firebase/authentication
// to drive Google + Apple sign-in via system UI (no Safari detour),
// then exchanges the resulting Firebase ID token for an Auth.js session
// cookie via /api/auth/native-signin. The magic-link input is hidden
// because the email link would open in Safari and the session cookie
// would land outside the WebView. (Universal Links to fix that are
// planned for v1.0.5.)
//
// Web + Android path: unchanged — uses next-auth/react signIn(),
// which handles Google/Apple via web OAuth redirects and Resend for
// magic links. Apple's external-browser objection was iOS-specific.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { signIn } from 'next-auth/react'
import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import LocaleSwitcher from '@/components/LocaleSwitcher'
import { useTranslations } from 'next-intl'

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
  const t = useTranslations('login')
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

  // Native iOS = the only platform that has the "external browser" UX
  // problem Apple Review called out. Android's WKWebView equivalent
  // already lets web OAuth complete in-app, so we keep the web flow
  // there to avoid regressing what's currently shipping under Google
  // Play closed-test review. Web/PWA also stays on the web flow.
  //
  // The `FirebaseAuthentication` registration check is the safety net
  // for our `server.url`-based Capacitor setup: this JS bundle is
  // served from Vercel and shared by ALL iOS builds, including any
  // older TestFlight build that doesn't ship the
  // @capacitor-firebase/authentication native plugin yet. Without
  // this check, an older build that loads the new JS would crash on
  // FirebaseAuthentication.signInWithGoogle() — "Plugin not
  // implemented". Falling back to the web OAuth flow keeps that path
  // working.
  const hasNativeFirebaseAuth =
    typeof window !== 'undefined' &&
    !!(window as unknown as { Capacitor?: { isPluginAvailable?: (n: string) => boolean } })
      .Capacitor?.isPluginAvailable?.('FirebaseAuthentication')
  const isNativeIos =
    typeof window !== 'undefined' &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'ios' &&
    hasNativeFirebaseAuth

  // ── Shared bridge: take a Firebase ID token from a native sign-in
  // and exchange it for an Auth.js session cookie. After this returns,
  // the WebView holds the session cookie, so we hard-reload to /home
  // so all React contexts re-mount in the signed-in state.
  async function exchangeFirebaseIdToken(idToken: string) {
    const res = await fetch('/api/auth/native-signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || `native sign-in failed (${res.status})`)
    }
    window.location.href = '/home'
  }

  // Native plugin errors come from heterogeneous origins (Apple
  // ASAuthorizationServices, Google Sign-In SDK, Firebase Auth), each
  // with their own cancel-signal conventions. We swallow every form of
  // "user dismissed the sheet" silently — surfacing it as red error
  // text would punish people for tapping Cancel.
  //
  // Apple iOS cancel: error message includes `AuthorizationError error 1000`
  //                   (ASAuthorizationErrorCanceled = 1000) and no "cancel" word
  // Google iOS cancel: Firebase plugin code === 'auth/cancelled-popup-request'
  //                    or 'auth/user-cancelled', or message contains "cancel"
  // Generic plugin cancel: code === 'cancelled' or 'CANCELED'
  const isCancelError = (e: unknown): boolean => {
    const err = e as { message?: string; code?: string | number }
    const msg = (err?.message || '').toLowerCase()
    const code = String(err?.code ?? '').toLowerCase()
    if (msg.includes('cancel')) return true                  // catches "canceled" / "cancelled"
    if (msg.includes('error 1000')) return true              // Apple ASAuthorization cancel
    if (code === 'cancelled' || code === 'canceled') return true
    if (code.includes('cancel')) return true                 // e.g. "auth/cancelled-popup-request"
    return false
  }

  const handleGoogle = async () => {
    setError(null)
    if (isNativeIos) {
      try {
        const result = await FirebaseAuthentication.signInWithGoogle()
        const idToken = result.credential?.idToken
        if (!idToken) throw new Error('Google sign-in returned no idToken')
        await exchangeFirebaseIdToken(idToken)
      } catch (e) {
        // Surfaces native plugin errors (network failure, misconfigured
        // OAuth client) so the user sees something actionable instead of
        // a dead sheet. Cancels are swallowed silently — see isCancelError.
        if (!isCancelError(e)) setError((e as Error)?.message || 'sign-in failed')
      }
      return
    }
    await signIn('google', { callbackUrl: '/home' })
  }

  const handleApple = async () => {
    setError(null)
    if (isNativeIos) {
      try {
        const result = await FirebaseAuthentication.signInWithApple()
        const idToken = result.credential?.idToken
        if (!idToken) throw new Error('Apple sign-in returned no idToken')
        await exchangeFirebaseIdToken(idToken)
      } catch (e) {
        if (!isCancelError(e)) setError((e as Error)?.message || 'sign-in failed')
      }
      return
    }
    await signIn('apple', { callbackUrl: '/home' })
  }

  const handleMagicLink = async () => {
    if (!email.trim()) return
    setSending(true)
    setError(null)
    try {
      await signIn('resend', { email: email.trim(), redirect: false })
      setSent(true)
    } catch {
      setError(t('errorSendLink'))
    }
    setSending(false)
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
          position: 'relative',
        }}
      >
        {/* Drag handle */}
        <div style={{
          width: 36, height: 4, background: 'rgba(255,255,255,0.12)',
          borderRadius: 2, margin: '0 auto 24px',
        }} />

        {/* Language switcher — top right, below clip area */}
        <div style={{ position: 'absolute', top: 32, right: 20, zIndex: 2 }}>
          <LocaleSwitcher size={28} direction="down" />
        </div>

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
                {(pendingRef.inviterName?.split(' ')[0]) || t('inviterFallback')} {t('invitedYou')}
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
                {t('joinSubtitle')}
              </div>
            </div>
            <div style={{
              width: 6, height: 6, background: GREEN, flexShrink: 0,
              clipPath: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
            }} />
          </div>
        )}

        <div style={{ textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
          {pendingRef ? t('headingReferral') : t('heading')}
        </div>
        <div style={{ textAlign: 'center', color: MUTED, fontSize: 12, marginBottom: 28 }}>
          {pendingRef ? t('subtitleReferral') : t('subtitle')}
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
              {t('checkEmail')}
            </div>
            <div style={{ color: MUTED, fontSize: 12 }}>
              {t('sentLink', { email })}
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
              {t('continueGoogle')}
            </button>

            {/* Apple button — App Store Guideline 4.8 requires us to offer
                Sign in with Apple when we also offer Google sign-in. Apple
                Human Interface Guidelines spec: black background, white
                logo + text, equal vertical rhythm to other sign-in CTAs. */}
            <button
              onClick={handleApple}
              style={{
                width: '100%', background: '#000', color: '#fff',
                clipPath: CLIP.button,
                padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none',
                fontFamily: 'inherit',
                marginTop: 10,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 384 512" aria-hidden="true">
                <path fill="#fff" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
              </svg>
              {t('continueApple')}
            </button>

            {/* Magic link block — hidden on native iOS because the email
                link opens in Safari and the session cookie would land
                outside the WebView. Universal Links wiring is the v1.0.5
                fix (see docs/superpowers/plans/handoff-2026-05-21.md if/
                when we add one). On Android + web, this stays available. */}
            {!isNativeIos && (
              <>
                {/* Divider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
                  <div style={{ flex: 1, height: 1, background: BORDER }} />
                  <div style={{ color: MUTED, fontSize: 11, fontWeight: 600, letterSpacing: '0.5px' }}>{t('or')}</div>
                  <div style={{ flex: 1, height: 1, background: BORDER }} />
                </div>

                {/* Magic link email */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="email"
                    placeholder={t('emailPlaceholder')}
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
                    {sending ? t('sending') : t('sendLink')}
                  </button>
                </div>

                <div style={{ textAlign: 'center', color: MUTED, fontSize: 10, marginTop: 14 }}>
                  {t('helperText')}
                </div>
              </>
            )}

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
