'use client'
// src/components/AppHeader.tsx
// Shared header with logo, animated search bar, and profile button.
// Used on home, feed, following, and matches pages.
// Hides on scroll down, shows on scroll up.

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import ProfileButton from '@/components/ProfileButton'
import NotificationBell from '@/components/NotificationBell'

import { useInvite } from '@/hooks/useInvite'
import { useAuth } from '@/components/AuthProvider'

const CHUNKY = {
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// First hint is translated; the rest are example queries that stay as-is
const STATIC_HINTS = [
  'Try "Arturo Coello"',
  'Try "Miami P1"',
  'Try "Live matches"',
  'Try "Gemma Triay"',
]

export default function AppHeader({ onSearchOpen }: { onSearchOpen?: () => void }) {
  const t = useTranslations('common')
  const { user } = useAuth()
  const { shareNow } = useInvite()

  // Defer auth-dependent rendering until after hydration to avoid
  // React #418 — SSR has user=null, client has cached user.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Rotating search hints
  const searchHints = [t('search'), ...STATIC_HINTS]
  const [hintIdx, setHintIdx] = useState(0)
  const [hintFading, setHintFading] = useState(false)
  useEffect(() => {
    const interval = setInterval(() => {
      setHintFading(true)
      setTimeout(() => {
        setHintIdx(i => (i + 1) % searchHints.length)
        setHintFading(false)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [searchHints.length])

  // Hide on scroll down, show on scroll up
  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollY = useRef(0)
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      if (y < 10) { setHeaderVisible(true) }
      else if (y > lastScrollY.current + 4) { setHeaderVisible(false) }
      else if (y < lastScrollY.current - 4) { setHeaderVisible(true) }
      lastScrollY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      background: '#0A0A0A',
      borderBottom: 'none',
      boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      height: 62,
      transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)',
      transition: 'transform 0.3s ease',
    }}>
      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/padelnachos-logo-v2.png"
        alt="PadelNachos"
        style={{ height: 52, objectFit: 'contain', flexShrink: 0 }}
      />

      {/* Search bar */}
      <div
        onClick={onSearchOpen}
        style={{
          flex: 1,
          height: 34,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.10)',
          clipPath: CHUNKY.button,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          cursor: 'pointer',
          marginLeft: 10,
          marginRight: 6,
          maxWidth: 260,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <span style={{
          color: 'rgba(255,255,255,0.7)',
          fontSize: 11,
          fontWeight: 500,
          opacity: hintFading ? 0 : 1,
          transform: hintFading ? 'translateY(-4px)' : 'translateY(0)',
          transition: 'opacity 0.3s, transform 0.3s',
        }}>
          {searchHints[hintIdx]}
        </span>
      </div>

      {/* Share icon — always visible */}
      {mounted && (
        <button
          onClick={() => { void shareNow() }}
          aria-label="Share PadelNachos"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            clipPath: CHUNKY.button,
            width: 34, height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            marginRight: 8,
            padding: 0,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      )}

      {/* Notifications bell — hidden when logged out */}
      {mounted && <NotificationBell />}

      {/* Profile / Login */}
      <ProfileButton />
    </header>
  )
}
