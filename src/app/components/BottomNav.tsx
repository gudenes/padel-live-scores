'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// ── Icons ──────────────────────────────────────────────────────────────────

function HomeIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? 'rgba(56,200,255,0.1)' : 'none'} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
}

function ScoresIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
    </svg>
  )
}

function FeedIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" fill={c}/>
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
    </svg>
  )
}

function RankingIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <path d="M12 20V10M18 20V4M6 20v-4"/>
    </svg>
  )
}

function EventsIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
    </svg>
  )
}

// ── Badge components ───────────────────────────────────────────────────────

function LiveBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span style={{
      position: 'absolute', top: -2, right: -2, zIndex: 2,
      minWidth: 16, height: 16, borderRadius: 8,
      background: 'var(--color-live)', color: '#fff',
      fontSize: 9, fontWeight: 800, lineHeight: '16px', textAlign: 'center',
      padding: '0 4px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      animation: 'badge-pop 2s ease-in-out infinite',
    }}>
      {count}
    </span>
  )
}

function LiveDot() {
  return (
    <span style={{
      position: 'absolute', top: 4, right: 4, zIndex: 2,
      width: 6, height: 6, borderRadius: '50%',
      background: 'var(--color-live)',
      animation: 'dot-blink 1.5s ease-in-out infinite',
    }} />
  )
}

function CountBadge({ count, bg }: { count: number; bg: string }) {
  if (count <= 0) return null
  return (
    <span style={{
      position: 'absolute', top: -2, right: 0, zIndex: 2,
      minWidth: 16, height: 16, borderRadius: 8,
      background: bg, color: '#fff',
      fontSize: 9, fontWeight: 800, lineHeight: '16px', textAlign: 'center',
      padding: '0 4px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    }}>
      {count > 9 ? '9+' : count}
    </span>
  )
}

function NewBadge() {
  return (
    <span style={{
      position: 'absolute', top: -2, right: -2, zIndex: 2,
      height: 16, borderRadius: 8,
      background: 'var(--color-star)', color: '#000',
      fontSize: 8, fontWeight: 900, lineHeight: '16px', textAlign: 'center',
      padding: '0 5px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    }}>
      NEW
    </span>
  )
}

function LiveRings() {
  return (
    <>
      <span style={{
        position: 'absolute', inset: -3, borderRadius: 14,
        border: '1.5px solid var(--color-live)',
        opacity: 0, animation: 'ring-pulse 2s ease-out infinite',
        pointerEvents: 'none',
      }} />
      <span style={{
        position: 'absolute', inset: -3, borderRadius: 14,
        border: '1.5px solid var(--color-live)',
        opacity: 0, animation: 'ring-pulse 2s ease-out infinite 1s',
        pointerEvents: 'none',
      }} />
    </>
  )
}

// ── Tabs config ────────────────────────────────────────────────────────────

const TABS = [
  { href: '/v2',             label: 'Home',    Icon: HomeIcon },
  { href: '/v2/matches',     label: 'Scores',  Icon: ScoresIcon },
  { href: '/v2/feed',        label: 'Feed',    Icon: FeedIcon },
  { href: '/v2/ranking',     label: 'Ranking', Icon: RankingIcon },
  { href: '/v2/tournaments', label: 'Events',  Icon: EventsIcon },
] as const

// ── CSS animations (injected once) ─────────────────────────────────────────

const NAV_STYLES = `
@keyframes ring-pulse {
  0% { opacity: 0.6; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.35); }
}
@keyframes badge-pop {
  0%, 100% { transform: scale(1); }
  8% { transform: scale(1.2); }
  16% { transform: scale(1); }
}
@keyframes dot-blink {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.4); }
}
`

// ── BottomNav component ───────────────────────────────────────────────────

export default function BottomNav() {
  const pathname = usePathname()
  const [liveCount, setLiveCount] = useState(0)
  const [newsCount, setNewsCount] = useState(0)
  const [rankingNew, setRankingNew] = useState(false)
  const [pressed, setPressed] = useState<string | null>(null)

  // Fetch badge data
  const fetchBadges = useCallback(async () => {
    const [liveRes, newsRes] = await Promise.all([
      supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'live'),
      supabase
        .from('articles')
        .select('id', { count: 'exact', head: true })
        .gte('published_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ])
    setLiveCount(liveRes.count ?? 0)
    setNewsCount(newsRes.count ?? 0)
  }, [])

  useEffect(() => {
    fetchBadges()
    const interval = setInterval(fetchBadges, 60_000)
    return () => clearInterval(interval)
  }, [fetchBadges])

  // Check if ranking was updated in last 24h
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('players')
        .select('updated_at')
        .not('ranking', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()
      if (data?.updated_at) {
        const hoursAgo = (Date.now() - new Date(data.updated_at).getTime()) / (1000 * 60 * 60)
        setRankingNew(hoursAgo < 24)
      }
    })()
  }, [])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NAV_STYLES }} />
      <nav style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500,
        display: 'flex', alignItems: 'stretch', justifyContent: 'space-around',
        background: 'rgba(17, 17, 17, 0.85)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        borderTop: '0.5px solid rgba(255,255,255,0.08)',
        padding: '6px 6px 8px',
        zIndex: 20,
      }}>
        {TABS.map(({ href, label, Icon }) => {
          const active = href === '/v2/tournaments'
            ? pathname.startsWith('/v2/tournaments')
            : pathname === href
          const isPressed = pressed === href
          const isHome = href === '/v2'
          const isScores = href === '/v2/matches'
          const isFeed = href === '/v2/feed'
          const isRanking = href === '/v2/ranking'

          return (
            <Link
              key={href}
              href={href}
              onPointerDown={() => setPressed(href)}
              onPointerUp={() => setPressed(null)}
              onPointerLeave={() => setPressed(null)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 4, textDecoration: 'none',
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
              }}
            >
              <div style={{
                width: active ? 44 : 38,
                height: 34, borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
                background: active ? 'rgba(56,200,255,0.1)' : 'transparent',
                transform: isPressed
                  ? 'scale(0.82)'
                  : active ? 'scale(1.05)' : 'scale(1)',
                transition: isPressed
                  ? 'transform 0.08s ease-in'
                  : 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}>
                {isHome && liveCount > 0 && <LiveRings />}
                <Icon active={active} />
                {isHome && liveCount > 0 && <LiveBadge count={liveCount} />}
                {isScores && liveCount > 0 && <LiveDot />}
                {isFeed && newsCount > 0 && <CountBadge count={newsCount} bg="var(--color-live)" />}
                {isRanking && rankingNew && <NewBadge />}
              </div>
              <span style={{
                fontSize: 9, fontWeight: active ? 800 : 700,
                letterSpacing: 0.3,
                color: active ? 'var(--color-accent)' : 'var(--text-faint)',
                transform: isPressed ? 'scale(0.9)' : 'scale(1)',
                transition: isPressed
                  ? 'transform 0.08s ease-in'
                  : 'all 0.2s ease',
              }}>
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
