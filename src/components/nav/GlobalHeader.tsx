'use client'
// src/components/nav/GlobalHeader.tsx
// The shared top header used on every top-level tab page (home,
// tournaments, rankings). Owns its own search overlay, rotating hint
// text, scroll-hide behaviour, and share button so pages just render
// <GlobalHeader /> with no plumbing.
//
// Extracted from src/app/[locale]/(app)/home/page.tsx in 2026-04-29
// when Tournaments and Ranking became their own top-level tabs and
// needed the same chrome.

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import SearchOverlay from '@/components/nav/SearchOverlay'
import ProfileButton from '@/components/ProfileButton'
import { CHUNKY } from '@/components/home/shared'
import { useInvite } from '@/hooks/useInvite'

export default function GlobalHeader() {
  const tHome = useTranslations('home')
  const { shareNow } = useInvite()
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

  // Hide-on-scroll-down / show-on-scroll-up. Each page mounts its own
  // GlobalHeader instance, so per-page scroll state is the right
  // behaviour — switching tabs starts with the header visible.
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
    <>
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

        {/* Search trigger — opens SearchOverlay */}
        <div
          data-coachmark="search"
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

        {/* Share button */}
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

        <ProfileButton />
      </header>

      {/* Mounted alongside the header so it works on every tab. */}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
