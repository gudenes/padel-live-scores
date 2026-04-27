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
import MatchesDaySwipe from '@/components/MatchesDaySwipe'
import MatchesDayShimmer from '@/components/MatchesDayShimmer'
import { DailyDatePills } from '@/components/DailyDatePills'
import { addDaysIso, getLocaleHomeTz } from '@/lib/locale-time'
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

  return (
    <>
      {/* Sticky header strip — pills + filter. Composition matches the
          server page's layout so the swap doesn't shift anything. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(10,10,10,0.94)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <DailyDatePills selectedIso={activeIso} locale={locale} onSelect={goTo} />
        {!isLoadingActive && !isErrorActive && groups.length > 0 && (
          <MatchesFilterClient rootId="matches-filter-root" />
        )}
      </div>

      <MatchesDaySwipe
        prevIso={prevIso}
        nextIso={nextIso}
        locale={locale}
        onSwipe={goTo}
      >
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
      </MatchesDaySwipe>
    </>
  )
}
