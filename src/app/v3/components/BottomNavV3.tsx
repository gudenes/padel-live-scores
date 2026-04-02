'use client'
// src/app/v3/components/BottomNavV3.tsx
// Redesigned 3-tab bottom nav: Scores / Home (brand icon) / Feed
// Uses PadelNachos brand language: chunky shapes, green active state.

import { useEffect, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// ── Icons ───────────────────────────────────────────────────────

function ScoresIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M4.5 7.5C7 7 9.5 9 10 12c0.3 2-0.5 4.5-1.5 6.5" />
      <path d="M19.5 16.5C17 17 14.5 15 14 12c-0.3-2 0.5-4.5 1.5-6.5" />
    </svg>
  )
}

function FeedIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" fill={color} />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
      <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
    </svg>
  )
}

function HomeIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

// ── Colors ──────────────────────────────────────────────────────
const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.15)'
const DIM = '#4B5563'
const LIVE_RED = '#FF4655'

// ── Tabs ────────────────────────────────────────────────────────
const TABS = [
  { key: 'scores', label: 'Scores', href: '/v3/scores', icon: ScoresIcon },
  { key: 'home',   label: 'Home',   href: '/v3',        icon: null },
  { key: 'feed',   label: 'Feed',   href: '/v3/feed',   icon: FeedIcon },
] as const

export default function BottomNavV3() {
  const pathname = usePathname()
  const [liveCount, setLiveCount] = useState(0)

  // Determine active tab
  const activeKey =
    pathname === '/v3' || pathname === '/v3/' ? 'home' :
    pathname.startsWith('/v3/scores') ? 'scores' :
    pathname.startsWith('/v3/feed') ? 'feed' :
    'home'

  // Fetch live match count for badge
  const fetchBadges = useCallback(async () => {
    try {
      const { count } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'live')
      setLiveCount(count ?? 0)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchBadges()
    const interval = setInterval(fetchBadges, 60_000)
    return () => clearInterval(interval)
  }, [fetchBadges])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NAV_STYLES }} />
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 500,
        background: 'rgba(10,10,10,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'flex-end',
        padding: '8px 0 env(safe-area-inset-bottom, 20px)',
        zIndex: 200,
      }}>
        {TABS.map((tab) => {
          const isActive = activeKey === tab.key
          const color = isActive ? GREEN : DIM

          return (
            <Link
              key={tab.key}
              href={tab.href}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '8px 24px',
                position: 'relative',
                textDecoration: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Top bar indicator — chunky tab above icon */}
              <div style={{
                width: 40,
                height: 6,
                background: isActive ? GREEN : 'transparent',
                clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                transition: 'background 0.25s ease',
                marginBottom: 2,
              }} />

              {/* Icon wrapper */}
              <div style={{ position: 'relative', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                <div style={{ position: 'relative', zIndex: 2 }}>
                  {tab.key === 'home' ? (
                    <HomeIcon color={color} />
                  ) : (
                    tab.icon && <tab.icon color={color} />
                  )}
                </div>

                {/* Live badge on scores */}
                {tab.key === 'scores' && liveCount > 0 && (
                  <div className="v3-nav-badge">{liveCount}</div>
                )}
              </div>

              {/* Label */}
              <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  color: isActive ? GREEN : DIM,
                  textTransform: 'uppercase',
                  position: 'relative',
                  zIndex: 1,
                }}>
                  {tab.label}
                </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

const NAV_STYLES = `
  .v3-nav-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 18px;
    height: 16px;
    background: ${LIVE_RED};
    color: white;
    font-size: 9px;
    font-weight: 800;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    z-index: 3;
    clip-path: polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%);
    animation: v3-badge-pop 0.3s ease;
  }
  @keyframes v3-badge-pop {
    0% { transform: scale(0); }
    70% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
`
