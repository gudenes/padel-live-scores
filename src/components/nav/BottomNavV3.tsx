'use client'
// src/components/nav/BottomNavV3.tsx
// Redesigned 3-tab bottom nav: Scores / Home (brand icon) / Feed
// Uses PadelNachos brand language: chunky shapes, green active state.
//
// Phase 1 of the bottom-nav speed work (2026-04-27):
//   - Links use `prefetch={true}` so the RSC payload for every tab is
//     warmed at first paint. Subsequent taps hit Next.js's client cache
//     and feel near-instant.
//   - Per-tab scroll restoration: scroll position is saved to
//     sessionStorage on tab switch and replayed when the user returns
//     to a tab. Means swiping back to Feed lands where you left off.

import { useEffect, useRef, useState } from 'react'
import { usePathname, Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { useFeedLastVisit } from '@/hooks/useFeedLastVisit'

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

function FollowingIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

// Trophy icon for the Tournaments tab. Cup with handles + base —
// universal sport-trophy semantic. Same line-stroke style as the
// other nav icons.
function TournamentsIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

// Ranking icon — three ascending bars. The cleanest universal "ranking"
// pictogram; reads as "leaderboard" without the visual weight of a
// medal/podium. Bars align to a baseline like a chart.
function RankingIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="8" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  )
}

// ── Colors ──────────────────────────────────────────────────────
const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.15)'
const DIM = '#4B5563'
const LIVE_RED = '#FF4655'

// ── Tabs ────────────────────────────────────────────────────────
//
// Five top-level tabs after the 2026-04-29 reshuffle:
//   Home  ·  Matches  ·  Following  ·  Tournaments  ·  Ranking
// Feed is no longer a top-level tab — users reach the news listing
// via the home page's "Latest news" section. The unread-news badge
// previously on the Feed tab moved onto Home (same useFeedLastVisit
// data path, just a different display anchor).
const TABS = [
  { key: 'home',        labelKey: 'home' as const,        href: '/home',        icon: null },
  { key: 'scores',      labelKey: 'matches' as const,     href: '/matches',     icon: ScoresIcon },
  { key: 'following',   labelKey: 'following' as const,   href: '/following',   icon: FollowingIcon },
  { key: 'tournaments', labelKey: 'tournaments' as const, href: '/tournaments', icon: TournamentsIcon },
  { key: 'ranking',     labelKey: 'ranking' as const,     href: '/rankings',    icon: RankingIcon },
] as const

// Map a pathname to its top-level tab key. Anything outside the five
// tabs returns null (no scroll snapshot). `/feed` stays here for
// scroll-restoration even though there's no tab — users coming back
// from feed via in-page nav still benefit from the saved scroll.
function tabKeyFromPath(pathname: string): typeof TABS[number]['key'] | null {
  if (pathname === '/home' || pathname === '/home/') return 'home'
  if (pathname.startsWith('/matches')) return 'scores'
  if (pathname.startsWith('/following')) return 'following'
  if (pathname.startsWith('/tournaments')) return 'tournaments'
  if (pathname.startsWith('/rankings')) return 'ranking'
  return null
}

const SCROLL_STORAGE_PREFIX = 'bottomNavScroll:'

export default function BottomNavV3() {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const [liveCount, setLiveCount] = useState(0)
  const [newsCount, setNewsCount] = useState(0)
  const feedLastVisit = useFeedLastVisit()
  const lastTabRef = useRef<string | null>(null)

  // Determine active tab
  const activeKey = tabKeyFromPath(pathname) ?? 'home'

  // Per-tab scroll restoration. The save-side runs on the link's
  // onClick (BELOW) — we have to capture scrollY *before* Next.js
  // navigates because by the time the pathname-driven effect runs the
  // window has already snapped back to 0. The restore-side runs here
  // on every active-tab change.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const newKey = tabKeyFromPath(pathname)
    const oldKey = lastTabRef.current
    if (newKey && newKey !== oldKey) {
      try {
        const raw = sessionStorage.getItem(SCROLL_STORAGE_PREFIX + newKey)
        const y = raw ? Number.parseInt(raw, 10) : 0
        if (!Number.isNaN(y) && y > 0) {
          // The new tab is still mounting; its body height may be
          // shorter than `y` for the first few frames, so a single
          // scrollTo would be clamped to (whatever's available) and
          // leave the user at the top. Poll the document height a
          // handful of times until it can accept the saved scroll, or
          // give up after ~800ms.
          let attempts = 0
          const tryRestore = () => {
            const max =
              document.documentElement.scrollHeight - window.innerHeight
            if (max >= y) {
              window.scrollTo(0, y)
              return
            }
            attempts += 1
            if (attempts < 16) {
              requestAnimationFrame(tryRestore)
            } else {
              // Last-resort: scroll as far as we can.
              window.scrollTo(0, max)
            }
          }
          requestAnimationFrame(tryRestore)
        }
      } catch {
        // sessionStorage may be unavailable in private mode — silent.
      }
    }
    lastTabRef.current = newKey
  }, [pathname])

  // Save scroll BEFORE navigating away from the current tab.
  function saveCurrentScroll() {
    if (typeof window === 'undefined') return
    const currentKey = tabKeyFromPath(pathname)
    if (!currentKey) return
    try {
      sessionStorage.setItem(
        SCROLL_STORAGE_PREFIX + currentKey,
        String(window.scrollY),
      )
    } catch {
      // ignore
    }
  }

  // Poll badge counts. Re-runs whenever the user's last-visit timestamp
  // changes (e.g. they open the feed and markFeedVisited() fires).
  // Feed badge = number of articles published since their last visit.
  useEffect(() => {
    let cancelled = false

    async function fetchBadges() {
      try {
        const [liveRes, newsRes] = await Promise.all([
          supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'live'),
          supabase.from('articles').select('*', { count: 'exact', head: true })
            .eq('status', 'active')
            .gt('published_at', feedLastVisit),
        ])
        if (cancelled) return
        setLiveCount(liveRes.count ?? 0)
        setNewsCount(newsRes.count ?? 0)
      } catch { /* silent */ }
    }

    void fetchBadges()
    const interval = setInterval(() => { void fetchBadges() }, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [feedLastVisit])

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
        paddingTop: 4,
        paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 16px)',
        zIndex: 200,
      }}>
        {TABS.map((tab) => {
          const isActive = activeKey === tab.key
          const color = isActive ? GREEN : DIM

          return (
            <Link
              key={tab.key}
              href={tab.href}
              prefetch={true}
              data-coachmark={tab.key === 'following' ? 'following' : undefined}
              onClick={saveCurrentScroll}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 16px',
                position: 'relative',
                textDecoration: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Top bar indicator — inside edge of nav. Sized 20%
                  larger than the original (40×4) for stronger active-
                  tab signalling at five-tab density. Stays centred. */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 48,
                height: 5,
                background: isActive ? GREEN : 'transparent',
                clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                transition: 'background 0.25s ease',
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
                {/* Unread-news badge on Home — moved from the Feed tab
                    when Feed was demoted out of the bottom nav. The
                    underlying data flow is unchanged: useFeedLastVisit
                    + a count of articles since that timestamp. The
                    badge clears when the user actually visits /feed
                    (the feed page calls markFeedVisited on mount). */}
                {tab.key === 'home' && newsCount > 0 && (
                  <div className="v3-nav-badge">{newsCount > 9 ? '9+' : newsCount}</div>
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
                  {t(tab.labelKey)}
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
