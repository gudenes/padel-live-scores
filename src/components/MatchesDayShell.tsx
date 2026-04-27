'use client'

// src/components/MatchesDayShell.tsx
//
// Client wrapper that turns /matches/[date] into an instant day-swap
// experience. The server still renders the initial day for SEO + first
// paint, but once this shell mounts:
//
//   1. The visible day's groups are seeded into a local cache.
//   2. The 6 adjacent days (−3..+3 of the current iso) are prefetched
//      in the background via /api/matches/by-date.
//   3. Pill clicks + horizontal swipes call setActiveIso instead of
//      navigating; the URL is updated via history.replaceState so the
//      page is shareable but Next.js doesn't trigger an RSC round-trip.
//   4. If the user clicks a day that isn't yet cached (rare — only the
//      first ±300ms after page load), a shimmer is shown until fetch
//      lands.
//
// The shell does NOT manage the scroll position or the sticky header —
// the parent server page composes those around it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import EmptyState from '@/components/EmptyState'
import MatchesFilterClient from '@/components/MatchesFilterClient'
import MatchesTournamentGroup from '@/components/MatchesTournamentGroup'
import MatchesDayShimmer from '@/components/MatchesDayShimmer'
import { DailyDatePills } from '@/components/DailyDatePills'
import { addDaysIso, getLocaleHomeTz, isLocaleToday, getLocaleTodayIso } from '@/lib/locale-time'
import { useDaySwipe } from '@/hooks/useDaySwipe'
import type { MatchesDayGroup } from '@/lib/fetch-matches-day'

const CACHE_NEIGHBOUR_RANGE = 3 // prefetch ±3 days around active

interface Props {
  /** ISO YYYY-MM-DD that the server rendered on the initial paint. */
  initialIso: string
  /** Groups already in the DOM at render time — seeds the cache. */
  initialGroups: MatchesDayGroup[]
  locale: string
  userTz: string
  /** Translated tDaily('noMatchesTitle' / 'noMatchesSub') passed in
   *  so this client component doesn't need its own translator. */
  emptyStateTitle: string
  emptyStateSubtitle: string
}

type CacheEntry =
  | { state: 'loaded'; groups: MatchesDayGroup[] }
  | { state: 'loading' }
  | { state: 'error' }

export default function MatchesDayShell({
  initialIso,
  initialGroups,
  locale,
  userTz,
  emptyStateTitle,
  emptyStateSubtitle,
}: Props) {
  const tDaily = useTranslations('daily')
  const tz = useMemo(() => getLocaleHomeTz(locale), [locale])

  const [activeIso, setActiveIso] = useState(initialIso)
  // Pill-window iso. Usually mirrors activeIso 1:1, but the "Today"
  // shortcut decouples them: the matches body snaps to today
  // immediately (activeIso) while this state walks through the
  // intermediate days so the user sees the pill window roll past each
  // date instead of jumping. See `rollToToday` below.
  const [pillIso, setPillIso] = useState(initialIso)
  // Map<iso, CacheEntry>. Initial day is seeded synchronously so the
  // first paint after hydration matches what the SSR rendered.
  const [cache, setCache] = useState<Map<string, CacheEntry>>(() => {
    const m = new Map<string, CacheEntry>()
    m.set(initialIso, { state: 'loaded', groups: initialGroups })
    return m
  })

  // Track in-flight requests so a rapid pill flick doesn't duplicate.
  const inFlightRef = useRef<Set<string>>(new Set())

  const setEntry = useCallback((iso: string, entry: CacheEntry) => {
    setCache((prev) => {
      const next = new Map(prev)
      next.set(iso, entry)
      return next
    })
  }, [])

  const fetchDay = useCallback(
    async (iso: string) => {
      if (inFlightRef.current.has(iso)) return
      inFlightRef.current.add(iso)
      // Mark loading only if we don't already have data — avoids a
      // shimmer flash when revalidating a day in the background.
      setCache((prev) => {
        const cur = prev.get(iso)
        if (cur && cur.state === 'loaded') return prev
        const next = new Map(prev)
        next.set(iso, { state: 'loading' })
        return next
      })
      try {
        const res = await fetch(
          `/api/matches/by-date?date=${encodeURIComponent(iso)}&locale=${encodeURIComponent(locale)}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = (await res.json()) as { groups: MatchesDayGroup[] }
        setEntry(iso, { state: 'loaded', groups: payload.groups ?? [] })
      } catch (err) {
        console.warn('[MatchesDayShell] fetch failed', iso, err)
        setEntry(iso, { state: 'error' })
      } finally {
        inFlightRef.current.delete(iso)
      }
    },
    [locale, setEntry],
  )

  // Prefetch −3..+3 days around the active day. Runs on every activeIso
  // change so swiping into a new window pulls the next ring lazily.
  useEffect(() => {
    const offsets = [-3, -2, -1, 1, 2, 3]
    for (const off of offsets) {
      const iso = addDaysIso(activeIso, off, tz)
      const entry = cache.get(iso)
      if (!entry || entry.state === 'error') {
        // Stagger a touch so the first pill click doesn't compete with
        // a burst of background fetches for bandwidth.
        setTimeout(() => fetchDay(iso), Math.abs(off) * 80)
      }
    }
  }, [activeIso, tz, cache, fetchDay])

  // Update the URL bar without triggering a Next.js navigation. Scroll
  // position is preserved.
  useEffect(() => {
    if (activeIso === initialIso) return
    if (typeof window === 'undefined') return
    const localePrefix = locale === 'en' ? '' : `/${locale}`
    const url = `${localePrefix}/matches/${activeIso}${window.location.search}${window.location.hash}`
    window.history.replaceState(window.history.state, '', url)
  }, [activeIso, initialIso, locale])

  const goTo = useCallback(
    (iso: string) => {
      setActiveIso(iso)
      setPillIso(iso)
      // If the day isn't loaded yet, kick a fetch right away (don't
      // wait for the prefetch effect, which only schedules with delay).
      const entry = cache.get(iso)
      if (!entry || entry.state === 'error') {
        fetchDay(iso)
      }
    },
    [cache, fetchDay],
  )

  const prevIso = useMemo(() => addDaysIso(activeIso, -1, tz), [activeIso, tz])
  const nextIso = useMemo(() => addDaysIso(activeIso, 1, tz), [activeIso, tz])

  const activeEntry = cache.get(activeIso)
  const isLoadingActive = !activeEntry || activeEntry.state === 'loading'
  const isErrorActive = activeEntry?.state === 'error'
  const groups = activeEntry?.state === 'loaded' ? activeEntry.groups : []

  // Live swipe gesture — translate is shared between the body wrapper
  // AND the sticky header so the day pills drag with the finger. On
  // commit (>= 80px), `goTo` swaps the cached day in.
  const { touchHandlers, translate, active: swipeActive } = useDaySwipe({
    prevIso,
    nextIso,
    onSwipe: goTo,
  })
  const swipeStyle = {
    transform: translate ? `translateX(${translate}px)` : undefined,
    transition: swipeActive
      ? 'none'
      : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
  } as const

  // Today shortcut — surfaced next to FILTROS when the user is parked on
  // any day other than today. Tapping it lets the matches body snap to
  // today's content immediately while the day-pill strip glides smoothly
  // toward the new centre, the way a carousel swipe feels rather than a
  // discrete state-flicker.
  const todayIso = useMemo(() => getLocaleTodayIso(locale), [locale])
  const isOnToday = isLocaleToday(activeIso, locale)

  // Carousel-style slide on Today click. Driven by the Web Animations
  // API instead of a React-controlled CSS transition: WAAPI runs on
  // the compositor thread, immune to React 19's automatic batching
  // (which kept collapsing our 360→0 state pair into a single render
  // and skipping the animation entirely). The strip's pillIso is
  // re-centred on today *immediately*; the wrapper's transform animates
  // smoothly from the old offset back to 0 over 1.1s.
  const ROLL_DURATION_MS = 1100
  const ROLL_EASING = 'cubic-bezier(0.5, 0.0, 0.5, 1.0)'
  // Each pill is 54px wide with a 6px row gap → 60px stride.
  const PILL_STRIDE_PX = 60
  const rollWrapperRef = useRef<HTMLDivElement | null>(null)

  const rollToToday = useCallback(() => {
    const fromMs = Date.parse(pillIso + 'T12:00:00Z')
    const toMs = Date.parse(todayIso + 'T12:00:00Z')
    const dayDiff = Math.round((toMs - fromMs) / 86_400_000)
    if (dayDiff === 0) return

    // Body + URL snap to today right away.
    setActiveIso(todayIso)
    const todayEntry = cache.get(todayIso)
    if (!todayEntry || todayEntry.state === 'error') {
      fetchDay(todayIso)
    }
    setPillIso(todayIso)

    // Animate the rendered (re-centred-on-today) strip from where the
    // old window visually was to its natural centre. WAAPI bypasses
    // React; the animation reads "from offset=360 to offset=0" no
    // matter how many re-renders happen between now and finish.
    const offset = dayDiff * PILL_STRIDE_PX
    const node = rollWrapperRef.current
    if (node && typeof node.animate === 'function') {
      node.animate(
        [
          { transform: `translateX(${offset}px)` },
          { transform: 'translateX(0px)' },
        ],
        { duration: ROLL_DURATION_MS, easing: ROLL_EASING, fill: 'none' },
      )
    }
  }, [pillIso, todayIso, cache, fetchDay])

  return (
    <>
      {/* Sticky header strip — pills + filter. Composition matches the
          server page's layout so the swap doesn't shift anything. The
          inner wrapper carries the same translateX as the body so the
          pills track the finger during a swipe. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(10,10,10,0.94)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          overflow: 'hidden',
        }}
      >
        <div style={swipeStyle}>
          <div ref={rollWrapperRef}>
            <DailyDatePills selectedIso={pillIso} locale={locale} onSelect={goTo} />
          </div>
        </div>
        {/* Filter bar is always visible — even on empty days the user
            should be able to flip filters or hop back to today without
            having to first land on a populated day. */}
        <MatchesFilterClient
          rootId="matches-filter-root"
          leftSlot={
            !isOnToday ? (
              <button
                type="button"
                onClick={() => rollToToday()}
                aria-label={tDaily('today')}
                style={{
                  background: '#0A0A0A',
                  color: '#7ED321',
                  border: '1px solid rgba(126,211,33,0.4)',
                  clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                  padding: '8px 14px',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {tDaily('today')}
              </button>
            ) : undefined
          }
        />
      </div>

      <div {...touchHandlers} style={{ ...swipeStyle, touchAction: 'pan-y' }}>
        {/* `key` swap forces React to remount the body — runs the
            `.matches-day-fade` keyframe + scrolls any sub-state back to
            initial without a jarring page-flash. */}
        <div className="matches-day-fade" key={activeIso}>
          {isLoadingActive ? (
            <MatchesDayShimmer />
          ) : isErrorActive ? (
            <div style={{ padding: '8px 16px 24px' }}>
              <EmptyState
                title={tDaily('noMatchesTitle')}
                subtitle={tDaily('noMatchesSub')}
              />
            </div>
          ) : groups.length === 0 ? (
            <div style={{ padding: '8px 16px 24px' }}>
              <EmptyState title={emptyStateTitle} subtitle={emptyStateSubtitle} />
            </div>
          ) : (
            <div id="matches-filter-root" style={{ padding: '0 8px' }}>
              {groups.map((g) => (
                <MatchesTournamentGroup
                  key={g.tournamentId}
                  group={{
                    tournamentId: g.tournamentId,
                    tournamentName: g.tournamentName,
                    tournamentLevel: g.tournamentLevel,
                    tournamentCountry: g.tournamentCountry,
                    tournamentStartsAt: g.tournamentStartsAt,
                    tournamentEndsAt: g.tournamentEndsAt,
                    tournamentStatus: g.tournamentStatus,
                    matches: g.matches as never,
                    isPremier: g.isPremier,
                    locale,
                    userTz,
                    labels: {
                      liveNow: tDaily('liveSection'),
                      upcoming: tDaily('upcomingSection'),
                      results: tDaily('finishedSection'),
                    },
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
