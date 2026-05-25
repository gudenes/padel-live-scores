'use client'
// src/components/nav/GlobalHeader.tsx
// The shared top header used on every top-level tab page (home,
// tournaments, rankings). Owns its own search overlay and rotating
// hint text so pages just render <GlobalHeader /> with no plumbing.
//
// Extracted from src/app/[locale]/(app)/home/page.tsx in 2026-04-29
// when Tournaments and Ranking became their own top-level tabs and
// needed the same chrome.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import SearchOverlay from '@/components/nav/SearchOverlay'
import ProfileButton from '@/components/ProfileButton'
import { CHUNKY } from '@/components/home/shared'

export default function GlobalHeader() {
  const tHome = useTranslations('home')
  const [searchOpen, setSearchOpen] = useState(false)

  // Rotating search-box hint text. Same five hints the home page used
  // before the extract; lives here now so every tab cycles together.
  const SEARCH_HINTS = [
    tHome('searchHint0'),
    tHome('searchHint1'),
    tHome('searchHint2'),
    tHome('searchHint3'),
    tHome('searchHint4'),
  ]
  const [hintIdx, setHintIdx] = useState(0)
  const [hintFading, setHintFading] = useState(false)
  useEffect(() => {
    const interval = setInterval(() => {
      setHintFading(true)
      setTimeout(() => {
        setHintIdx(i => (i + 1) % SEARCH_HINTS.length)
        setHintFading(false)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Always-pinned sticky header. We tried hide-on-scroll twice and
  // both attempts had subtle interaction bugs inside the Capacitor iOS
  // WebView (pointer dead-zone after scroll-up, twitchy state during
  // inertial scroll). Sofascore/ESPN/OneFootball all use always-visible
  // mobile headers — that's the pattern we converge on. The body's
  // padding-top: env(safe-area-inset-top) (set in globals.css) gives
  // the iOS Dynamic Island its clearance, and the body background-color
  // is matched to the header background so the safe-area gap looks
  // like a continuation of the header rather than a separate band.

  return (
    <>
      <header style={{
        position: 'sticky',
        // env(safe-area-inset-top) — NOT 0 — because position:sticky pins
        // relative to the scroll-container's viewport, not to the body's
        // content area. With `top: 0`, the header would scroll into the
        // Dynamic Island / status bar zone once the body's safe-area
        // padding scrolled off-screen. Pinning at env(safe-area-inset-top)
        // keeps the header anchored directly below the system UI at
        // every scroll position. On platforms without notches, env()
        // returns 0px so behavior is identical to the old code.
        top: 'env(safe-area-inset-top, 0px)',
        zIndex: 100,
        background: '#0A0A0A',
        borderBottom: 'none',
        boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        height: 62,
      }}>
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/padelnachos-logo-v2.png"
          alt="PadelNachos"
          style={{ height: 52, objectFit: 'contain', flexShrink: 0 }}
        />

        {/* Search trigger — opens SearchOverlay */}
        <div
          onClick={() => setSearchOpen(true)}
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
            {SEARCH_HINTS[hintIdx]}
          </span>
        </div>

        <ProfileButton />
      </header>

      {/* Mounted alongside the header so it works on every tab. */}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
