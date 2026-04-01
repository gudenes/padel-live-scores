'use client'
// src/components/LoginSheet.tsx
// Bottom sheet for sign-in: Google OAuth + magic link email fallback.
// Slides up from bottom with dimmed backdrop.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'

interface LoginSheetProps {
  open: boolean
  onClose: () => void
}

export default function LoginSheet({ open, onClose }: LoginSheetProps) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!open || !mounted) return null

  const handleGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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
        emailRedirectTo: `${window.location.origin}/auth/callback`,
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
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: 'var(--bg-card)', borderRadius: '20px 20px 0 0',
          padding: '24px 20px 32px',
          borderTop: '1px solid var(--border-card)',
          animation: 'slideUp 0.3s ease-out',
        }}
      >
        {/* Drag handle */}
        <div style={{
          width: 36, height: 4, background: 'rgba(255,255,255,0.2)',
          borderRadius: 2, margin: '0 auto 20px',
        }} />

        <div style={{ textAlign: 'center', color: 'var(--text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
          Sign in to PadelNacho
        </div>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, marginBottom: 24 }}>
          Sync bookmarks & get match notifications
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✉️</div>
            <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              Check your email
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              We sent a sign-in link to {email}
            </div>
          </div>
        ) : (
          <>
            {/* Google button */}
            <button
              onClick={handleGoogle}
              style={{
                width: '100%', background: '#fff', color: '#333', borderRadius: 12,
                padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer', border: 'none',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-card)' }} />
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>or</div>
              <div style={{ flex: 1, height: 1, background: 'var(--border-card)' }} />
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
                  flex: 1, background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--border-card)', borderRadius: 10,
                  padding: '12px 14px', color: 'var(--text-primary)', fontSize: 13,
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={handleMagicLink}
                disabled={sending || !email.trim()}
                style={{
                  background: '#f59e0b', color: '#000', borderRadius: 10,
                  padding: '12px 16px', fontWeight: 600, fontSize: 13,
                  whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
                  fontFamily: 'inherit',
                  opacity: sending || !email.trim() ? 0.5 : 1,
                }}
              >
                {sending ? 'Sending...' : 'Send link'}
              </button>
            </div>

            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 10, marginTop: 12 }}>
              We'll email you a sign-in link — no password needed
            </div>

            {error && (
              <div style={{ textAlign: 'center', color: '#ef4444', fontSize: 12, marginTop: 8 }}>{error}</div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  )
}
