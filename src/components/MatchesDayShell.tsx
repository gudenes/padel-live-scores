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
import { supabase } from '@/lib/supabase'
import { nextDayWithMatches } from '@/lib/fetch-matches-calendar'

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
  const tOffline = useTranslations('offline')
  const tz = useMemo(() => getLocaleHomeTz(locale), [locale])

  // Offline banner — hydration-safe (defaults to hidden on SSR; window
  // listeners only run client-side). When navigator.onLine flips, we
  // reveal a small "last connected at HH:mm" strip just below the
  // sticky header so the user knows scores may be stale. We capture the
  // ms timestamp once on disconnect and re-format on render — keeps the
  // listener effect locale-independent (no re-binding on locale change)
  // and preserves the original disconnect moment if the offline event
  // re-fires while still offline.
  const [showOfflineBanner, setShowOfflineBanner] = useState(false)
  const [offlineSinceMs, setOfflineSinceMs] = useState<number | null>(null)

  useEffect(() => {
    function update() {
      const online = navigator.onLine
      setShowOfflineBanner(!online)
      setOfflineSinceMs((cur) => (online ? null : cur ?? Date.now()))
    }
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const offlineTime = offlineSinceMs
    ? new Date(offlineSinceMs).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

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

  // Calendar metadata — `maxScheduledIso` caps the forward day picker
  // and `daysWithMatches` powers the empty-state "Next matches" CTA.
  // `hasLiveNow` gates the LIVE pill's tap behaviour (jump to today vs.
  // toast). Empty defaults on the first render so the shell doesn't gate
  // paint on the calendar fetch.
  const [daysWithMatches, setDaysWithMatches] = useState<string[]>([])
  const [maxScheduledIso, setMaxScheduledIso] = useState<string | null>(null)
  const [hasLiveNow, setHasLiveNow] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/matches/calendar?locale=${encodeURIComponent(locale)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (cancelled || !p) return
        if (Array.isArray(p.daysWithMatches)) setDaysWithMatches(p.daysWithMatches)
        if (typeof p.maxScheduledIso === 'string' || p.maxScheduledIso === null) {
          setMaxScheduledIso(p.maxScheduledIso ?? null)
        }
        if (typeof p.hasLiveNow === 'boolean') setHasLiveNow(p.hasLiveNow)
      })
      .catch((err) => {
        // Silent: a missing boundary just falls back to "no cap" — the
        // pre-feature UX, never a hard failure.
        console.warn('[MatchesDayShell] calendar fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [locale])

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

  // Realtime subscription — list-shape watcher only.
  //
  // Each card now subscribes to its own match via useLiveMatch when its
  // status is live/on_court, so score ticks (sets + games changes) no
  // longer need to flow through the parent. The parent's only job is
  // to react to list-shape changes: new matches scheduled, status
  // transitions in/out of live, finishes that need to move a card from
  // the live bucket to the results bucket.
  //
  // Debounced (1.5s) to absorb the inevitable status-flip + finished_at
  // double-write. The sets/games subs from the previous architecture
  // are intentionally gone — they were the source of the matches list
  // visibly lagging score ticks by up to 1.5s.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null
    const triggerRefetch = () => {
      if (pending) return
      pending = setTimeout(() => {
        pending = null
        const inFlight = inFlightRef.current.has(activeIso)
        if (!inFlight) fetchDay(activeIso)
      }, 1500)
    }
    const channel = supabase
      .channel(`matches-day-${activeIso}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, triggerRefetch)
      .subscribe()
    return () => {
      if (pending) clearTimeout(pending)
      supabase.removeChannel(channel)
    }
  }, [activeIso, fetchDay])

  // Update the URL bar without triggering a Next.js navigation. Scroll
  // position is preserved.
  useEffect(() => {
    if (activeIso === initialIso) return
    if (typeof window === 'undefined') return
    const localePrefix = locale === 'en' ? '' : `/${locale}`
    const url = `${localePrefix}/matches/${activeIso}${window.location.search}${window.location.hash}`
    window.history.replaceState(window.history.state, '', url)
  }, [activeIso, initialIso, locale])

  // Boundary-aware ref so `goTo` (memoised on cache + fetchDay) can
  // read the current cap without recreating on every cap change. We
  // re-evaluate inside the callback so a stale closure can't let a
  // forward-swipe slip past the boundary. The actual `boundaryRef
  // .current = boundaryIso` sync happens further down once
  // `boundaryIso` is declared — this just initialises the ref.
  const boundaryRef = useRef<string | null>(null)

  const goTo = useCallback(
    (iso: string) => {
      // Forward-boundary guard: pills past the cap render disabled, but
      // the swipe gesture doesn't know about pill state. Drop the
      // out-of-range target on the floor instead of rendering an empty
      // future day.
      if (boundaryRef.current && iso > boundaryRef.current) return
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

  // Forward boundary: at minimum `today + 3` is always reachable so
  // users can plan the next few days, but if matches go further (a
  // Premier P1 schedule that publishes a week ahead, say) the cap
  // extends to wherever data actually lives. Past that point pills +
  // arrow render as disabled and the swipe gesture is short-circuited.
  const todayIsoForCap = useMemo(() => getLocaleTodayIso(locale), [locale])
  const boundaryIso = useMemo(() => {
    const floor = addDaysIso(todayIsoForCap, 3, tz)
    if (!maxScheduledIso) return floor
    return floor >= maxScheduledIso ? floor : maxScheduledIso
  }, [todayIsoForCap, tz, maxScheduledIso])

  // Keep boundaryRef synced with the latest boundaryIso so goTo can
  // short-circuit out-of-range swipes without re-creating the callback
  // on every cap change.
  useEffect(() => {
    boundaryRef.current = boundaryIso
  }, [boundaryIso])

  // Suggested jump target when the active day is empty: soonest day
  // ≥ activeIso that has matches. Null when nothing's scheduled at
  // or after the active day in the lookahead window.
  const suggestedNextIso = useMemo(
    () => nextDayWithMatches(daysWithMatches, addDaysIso(activeIso, 1, tz)),
    [daysWithMatches, activeIso, tz],
  )

  const activeEntry = cache.get(activeIso)
  const isLoadingActive = !activeEntry || activeEntry.state === 'loading'
  const isErrorActive = activeEntry?.state === 'error'
  const groups = activeEntry?.state === 'loaded' ? activeEntry.groups : []

  // Drives whether the LIVE pill in the filter bar pulses. We only want
  // the red dot animating when there's actually something live to surface
  // — otherwise the pulse is a false alarm. `live` and `on_court` are
  // the only statuses that mean "ball is in play right now".
  const hasLiveMatches = groups.some((g) =>
    g.matches.some((m) => m.status === 'live' || m.status === 'on_court'),
  )

  // Live swipe gesture — translate drives the body wrapper's drag-feedback
  // transform, while `progress` (normalized to [-1, 1]) drives the day
  // picker's lime indicator slide. On commit (>= 80px), `goTo` swaps the
  // cached day in.
  //
  // The pill strip itself no longer translates with the finger — the
  // sliding lime indicator is the sole visual signal in the picker.
  const {
    touchHandlers,
    translate,
    progress: swipeProgress,
    active: swipeActive,
  } = useDaySwipe({
    prevIso,
    nextIso,
    onSwipe: goTo,
  })
  const bodySwipeStyle = {
    transform: translate ? `translateX(${translate}px)` : undefined,
    transition: swipeActive
      ? 'none'
      : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
  } as const

  // Today shortcut — surfaced next to FILTROS when the user is parked on
  // any day other than today. Tapping it updates `pillIso` to today and
  // lets `DailyDatePills`' own layout effect smooth-scroll the rail so
  // today's pill lands in the centre, while the lime indicator's CSS
  // `left` transition glides it onto today's pill in lockstep. No
  // wrapper translate / WAAPI — keeping a single motion (the rail
  // scroll) avoids the "everything reloads from the right" feel that
  // came from layering a WAAPI translate on top of the smooth-scroll.
  const todayIso = useMemo(() => getLocaleTodayIso(locale), [locale])
  const isOnToday = isLocaleToday(activeIso, locale)

  const rollToToday = useCallback(() => {
    if (pillIso === todayIso) return

    // Body + URL snap to today right away.
    setActiveIso(todayIso)
    const todayEntry = cache.get(todayIso)
    if (!todayEntry || todayEntry.state === 'error') {
      fetchDay(todayIso)
    }
    setPillIso(todayIso)
  }, [pillIso, todayIso, cache, fetchDay])

  // Format the suggested-next-iso into a short, human-friendly label
  // for the CTA button. Hoisted out of JSX so the i18n call site stays
  // readable.
  function formatJumpDate(iso: string, loc: string, timeZone: string): string {
    const d = new Date(iso + 'T12:00:00Z')
    return new Intl.DateTimeFormat(loc, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone,
    }).format(d)
  }

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
        <DailyDatePills
          selectedIso={pillIso}
          locale={locale}
          onSelect={goTo}
          maxIso={boundaryIso}
          swipeProgress={swipeProgress}
          swipeActive={swipeActive}
        />
        {/* Filter bar is always visible — even on empty days the user
            should be able to flip filters or hop back to today without
            having to first land on a populated day. */}
        <MatchesFilterClient
          rootId="matches-filter-root"
          hasLiveMatches={hasLiveMatches}
          hasLiveNow={hasLiveNow}
          isOnToday={isOnToday}
          onGoToToday={rollToToday}
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

      {showOfflineBanner && (
        <div
          style={{
            fontSize: 11,
            color: '#F5A623',
            background: 'rgba(245,166,35,0.08)',
            padding: '6px 16px',
            textAlign: 'center',
            fontWeight: 600,
          }}
        >
          {tOffline('banner', { time: offlineTime })}
        </div>
      )}

      <div {...touchHandlers} style={{ ...bodySwipeStyle, touchAction: 'pan-y' }}>
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
                action={
                  !isOnToday ? (
                    <BackToTodayButton
                      label={tDaily('backToToday')}
                      onClick={rollToToday}
                    />
                  ) : undefined
                }
              />
            </div>
          ) : groups.length === 0 ? (
            <div style={{ padding: '8px 16px 24px' }}>
              <EmptyState
                title={emptyStateTitle}
                subtitle={emptyStateSubtitle}
                action={
                  <EmptyDayActions
                    primary={
                      suggestedNextIso ? (
                        <NextMatchesJumpButton
                          iso={suggestedNextIso}
                          locale={locale}
                          label={tDaily('jumpToNextMatches', {
                            date: formatJumpDate(suggestedNextIso, locale, tz),
                          })}
                          onClick={() => goTo(suggestedNextIso)}
                        />
                      ) : undefined
                    }
                    secondary={
                      !isOnToday ? (
                        <BackToTodayButton
                          label={tDaily('backToToday')}
                          onClick={rollToToday}
                        />
                      ) : undefined
                    }
                  />
                }
              />
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
                    courtOrder: g.courtOrder ?? {},
                    courtLabel: tDaily('courtSection'),
                    unknownCourtLabel: tDaily('courtUnknown'),
                    liveCountLabel: tDaily('liveCount'),
                    isPremier: g.isPremier,
                    locale,
                    userTz,
                    dayBucketIso: activeIso,
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

// ── NextMatchesJumpButton ──────────────────────────────────────────
//
// CTA inside the empty-state when there are no matches today but the
// calendar lookahead found data on a later day. One tap routes the
// user straight to that day instead of forcing them to scroll the day
// picker forward looking for content.
//
// Visual style mirrors the "Hoy" button in the filter bar — chunky
// brand polygon, lime accent — so the affordance reads as a system
// jump rather than a normal action button.

interface NextMatchesJumpButtonProps {
  iso: string
  locale: string
  label: string
  onClick: () => void
}

function NextMatchesJumpButton({ label, onClick }: NextMatchesJumpButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: '#0A0A0A',
        color: '#7ED321',
        border: '1px solid rgba(126,211,33,0.4)',
        clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
        padding: '10px 18px',
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label} ›
    </button>
  )
}

// Secondary CTA on the empty-state for past dates: muted outline so it
// doesn't compete with the primary "Next matches" jump but still reads
// as a system action (chunky polygon, same shape as the primary).
function BackToTodayButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        color: '#9CA3AF',
        border: '1px solid rgba(255,255,255,0.18)',
        clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
        padding: '10px 18px',
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// Wraps the empty-state primary + secondary actions in a centered, wrap-
// safe row. When only one is rendered, the row collapses to that single
// button — keeping the empty card visually identical to its old form.
function EmptyDayActions({
  primary,
  secondary,
}: {
  primary?: React.ReactNode
  secondary?: React.ReactNode
}) {
  if (!primary && !secondary) return null
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        justifyContent: 'center',
        flexWrap: 'wrap',
      }}
    >
      {primary}
      {secondary}
    </div>
  )
}
