'use client'
import {PREDICT_LAUNCH_ENABLED} from '@/lib/predict-launch'
// src/components/nav/BottomNavV3.tsx
// Fixed four-slot bottom nav: Home / Matches / Ranking / Play
// Uses PadelNachos brand language: chunky shapes, green active state.
//
// Phase 1 of the bottom-nav speed work (2026-04-27):
//   - Links use `prefetch={true}` so the RSC payload for every tab is
//     warmed at first paint. Subsequent taps hit Next.js's client cache
//     and feel near-instant.
//   - Per-tab scroll restoration: scroll position is saved to
//     sessionStorage on tab switch and replayed when the user returns
//     to a tab. Means swiping back to Feed lands where you left off.

import JoystickSprite from './JoystickSprite'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { useFeedLastVisit } from '@/hooks/useFeedLastVisit'
import { useRankingsLastVisit } from '@/hooks/useRankingsLastVisit'
import { formatYearWeek } from '@/lib/iso-year-week'

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
const DIM = '#4B5563'
const LIVE_RED = '#FF4655'


// ── Tabs ────────────────────────────────────────────────────────
//
// Home · Matches · Ranking · Play (Following when Predict is disabled).
type TabKey = 'home' | 'scores' | 'following' | 'play' | 'tournaments' | 'ranking'
type NavLabelKey = 'home' | 'matches' | 'following' | 'play' | 'tournaments' | 'ranking'

interface NavTab {
  key: TabKey
  labelKey: NavLabelKey
  href: string
  icon: ((props: { color: string }) => React.JSX.Element) | null
}

const TABS: NavTab[] = [
  { key: 'home',        labelKey: 'home',        href: '/home',        icon: null },
  { key: 'scores',      labelKey: 'matches',     href: '/matches',     icon: ScoresIcon },
  { key: 'ranking',     labelKey: 'ranking',     href: '/rankings',    icon: RankingIcon },
  { key: 'following',   labelKey: 'following',   href: '/following',   icon: FollowingIcon },
]

// Play takes the slot Following holds — but only for users who actually
// have access. See PLAY_TAB_SWAP below; the swap is cosmetic, the real gate
// is the server component at src/app/[locale]/(app)/play/layout.tsx.
const PLAY_TAB: NavTab = { key: 'play', labelKey: 'play', href: '/play', icon: null }

// Map a pathname to its top-level tab key. Anything outside the five
// tabs returns null (no scroll snapshot). `/feed` stays here for
// scroll-restoration even though there's no tab — users coming back
// from feed via in-page nav still benefit from the saved scroll.
function tabKeyFromPath(pathname: string): TabKey | null {
  if (pathname === '/home' || pathname === '/home/') return 'home'
  if (pathname.startsWith('/matches')) return 'scores'
  if (pathname.startsWith('/play')) return 'play'
  if (pathname.startsWith('/following')) return 'following'
  if (pathname.startsWith('/tournaments')) return 'tournaments'
  if (pathname.startsWith('/rankings')) return 'ranking'
  return null
}

const SCROLL_STORAGE_PREFIX = 'bottomNavScroll:'

export default function BottomNavV3() {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const [joystickPressed,setJoystickPressed]=useState(false)
  const [liveCount, setLiveCount] = useState(0)
  const [newsCount, setNewsCount] = useState(0)
  const feedLastVisit = useFeedLastVisit()
  const lastVisitedRankingsWeek = useRankingsLastVisit()
  const [latestRankingsWeek, setLatestRankingsWeek] = useState<string | null>(null)
  const lastTabRef = useRef<string | null>(null)

  // ── Play tab visibility ──────────────────────────────────────
  // Public launch renders Play immediately, avoiding a Following-to-Play
  // swap after mounting. Restricted launches still check account access.
  const [playAllowed, setPlayAllowed] = useState(PREDICT_LAUNCH_ENABLED)
  useEffect(() => {
    if (PREDICT_LAUNCH_ENABLED) return
    let cancelled = false
    fetch('/api/play/access', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { allowed?: boolean } | null) => {
        if (!cancelled) setPlayAllowed(body?.allowed === true)
      })
      .catch(() => { /* no access, no tab — silent */ })
    return () => { cancelled = true }
  }, [])

  // Without access the array is untouched and Following keeps its slot,
  // exactly as before this feature existed.
  const tabs = useMemo(
    () => (playAllowed ? TABS.map((tab) => (tab.key === 'following' ? PLAY_TAB : tab)) : TABS),
    [playAllowed],
  )

  // Determine active tab
  const activeKey = tabKeyFromPath(pathname) ?? 'home'
  const showRankingNudge =
    latestRankingsWeek !== null && latestRankingsWeek !== lastVisitedRankingsWeek

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
        const [liveRes, newsRes, rankingsRes] = await Promise.all([
          supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'live'),
          PREDICT_LAUNCH_ENABLED ? Promise.resolve({count:0}) : supabase.from('articles').select('*', { count: 'exact', head: true })
            .eq('status', 'active')
            .gt('published_at', feedLastVisit),
          // Latest ranking week probe. Reads players.ranking_date (publicly
          // readable under RLS) and converts to ISO "YYYY-WW" client-side.
          // player_ranking_snapshots is the canonical source but isn't
          // anon-readable, so the dot logic would never fire if we queried
          // it from the browser.
          supabase
            .from('players')
            .select('ranking_date')
            .not('ranking_date', 'is', null)
            .order('ranking_date', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        if (cancelled) return
        setLiveCount(liveRes.count ?? 0)
        setNewsCount(newsRes.count ?? 0)
        const row = rankingsRes.data as { ranking_date: string | null } | null
        setLatestRankingsWeek(formatYearWeek(row?.ranking_date))
      } catch { /* silent */ }
    }

    void fetchBadges()
    const interval = setInterval(() => { void fetchBadges() }, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [feedLastVisit])

  if (pathname === '/avatar-shop' || pathname === '/avatar-preview') return null

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NAV_STYLES }} />
      <nav
        className="v3-nav"
        style={{
          position: 'fixed',
          // Lift above the native AdMob banner when one is showing. The
          // useAdMobBanner hook publishes the banner's real height to this
          // CSS var (0px when none / on web), so the nav clears the overlay.
          bottom: 'var(--admob-banner-h, 0px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: 500,
          background: 'rgba(10,10,10,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          alignItems: 'end',
          paddingTop: 4,
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 16px)',
          zIndex: 200,
        }}
      >
        <div className="v3-ink-bar" aria-hidden="true" style={{
          left: `calc(${(Math.max(0,tabs.findIndex(tab=>tab.key===activeKey)) + .5)*25}% - 24px)`,
          opacity: activeKey === 'play' ? 0 : 1,
        }}/>
        {tabs.map((tab) => {
          const isActive = activeKey === tab.key
          // Play is always lime: it's the hero action, not a state.
          const color = isActive || tab.key === 'play' ? GREEN : DIM

          return (
            <Link
              key={tab.key}
              href={tab.href}
              prefetch={true}
              aria-label={t(tab.labelKey)}
              aria-current={isActive ? 'page' : undefined}
              onClick={saveCurrentScroll}
              data-joystick-pressed={tab.key==='play'&&joystickPressed?true:undefined}
              onKeyDown={tab.key==='play'?event=>{if(event.key==='Enter')setJoystickPressed(true)}:undefined}
              onKeyUp={tab.key==='play'?()=>setJoystickPressed(false):undefined}
              onBlur={tab.key==='play'?()=>setJoystickPressed(false):undefined}
              className={`v3-nav-tab${isActive ? ' v3-tab-active' : ''}${tab.key === 'play' ? ' v3-tab-play' : ''}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 4px',
                height: 60,
                minWidth: 0,
                boxSizing: 'border-box',
                justifyContent: 'center',
                position: 'relative',
                textDecoration: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* The sprite sits inside a fixed slot without affecting layout. */}
              {tab.key === 'play' ? (
                <span className="v3-joystick-press" aria-hidden="true">
                  <JoystickSprite attention={!isActive}/>
                </span>
              ) : (
              /* Icon wrapper */
              <div className="v3-nav-icon" style={{ position: 'relative', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
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
                {!PREDICT_LAUNCH_ENABLED && tab.key === 'home' && newsCount > 0 && (
                  <div className="v3-nav-badge">{newsCount > 9 ? '9+' : newsCount}</div>
                )}
                {/* Rank-updated dot on Ranking — appears when a fresh
                    ranking week has been published since the user's
                    last visit to /rankings. Cleared when the rankings
                    page calls markRankingsVisited on mount. Different
                    visual from the red unread-count badges above
                    (green dot, no number) because the semantic is
                    "something new this week", not a counter. */}
                {tab.key === 'ranking' && showRankingNudge && (
                  <div className="v3-nav-rank-dot" aria-label={t('rankUpdated')} />
                )}
              </div>
              )}

              {/* Labels keep the same position across tab changes. */}
              {tab.key !== 'play' && <NavLabel
                text={t(tab.labelKey)}
                isActive={isActive}
                color={color}
              />}
            </Link>
          )
        })}
      </nav>
    </>
  )
}

// Labels stay still when the active tab changes.
function NavLabel({text,color}:{text:string;isActive:boolean;color:string}) {
  return <span style={{fontSize:10,fontWeight:700,letterSpacing:0.3,color,textTransform:'uppercase',whiteSpace:'nowrap'}}>{text}</span>
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

  /* Rank-updated nudge dot — distinct from the red unread-count
     badges: solid green to match the active-tab color, no number,
     no animation. Sits in the icon wrapper's top-right corner with
     a dark-bg ring so it reads against icon strokes and the nav. */
  .v3-nav-rank-dot {
    position: absolute;
    top: 0px;
    right: 1px;
    width: 8px;
    height: 8px;
    background: ${GREEN};
    border-radius: 50%;
    box-shadow: 0 0 0 2px rgba(10,10,10,0.96);
    z-index: 3;
  }

  /* The original chunky top notch moves independently of the fixed slots. */
  .v3-ink-bar { position:absolute; top:0; width:48px; height:5px; background:${GREEN}; clip-path:polygon(3% 5%,97% 0%,100% 95%,0% 100%); pointer-events:none; transition:left .36s cubic-bezier(.34,1.56,.64,1); }
  @media(prefers-reduced-motion:reduce){ .v3-ink-bar { transition:none; } }
  .v3-tab-play.v3-tab-active::after { content:''; position:absolute; bottom:0; left:calc(50% - 10px); width:20px; height:3px; background:#7ed321; border-radius:2px; }
  .v3-joystick-press { position:absolute; display:block; width:70.4px; height:70.4px; bottom:4px; left:calc(50% - 35.2px); z-index:2; }
  .v3-tab-play:focus-visible { outline:2px solid #b6e688; outline-offset:-2px; }
`
