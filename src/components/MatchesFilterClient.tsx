'use client'

// src/components/MatchesFilterClient.tsx
//
// Client wrapper that adds filter capability to the server-rendered
// match list at /matches/[date]. Three responsibilities:
//
//   1. Render the filter bar (summary + open button) and the drawer.
//   2. Hold filter state (via useMatchesFilters — localStorage backed).
//   3. Apply filters to the DOM by toggling `display: none` on
//      server-rendered nodes carrying `data-match` / `data-tour-group`
//      / `data-section` attributes.
//
// Why DOM manipulation rather than re-rendering? The server already
// renders the entire list (SEO requires it — Google should see all the
// day's matches). Filtering is a post-render visibility toggle, so we
// avoid duplicating ~300 lines of render code in a client component
// AND keep the unfiltered HTML in the markup for crawlers.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { useMatchesFilters, type MatchesFilters } from '@/hooks/useMatchesFilters'
import EmptyState from './EmptyState'
import MatchesFilterBar from './MatchesFilterBar'
import MatchesFilterDrawer from './MatchesFilterDrawer'

export interface MatchesFilterClientProps {
  /** ID of the wrapper div the server renders around all match nodes.
   *  Used as the root for visibility toggling. */
  rootId: string
  /** Whether any match in the active day has status='live'/'on_court'.
   *  Drives the LIVE pill's pulse — when nothing is actually live we
   *  want the dot static so the pill doesn't cry wolf. */
  hasLiveMatches: boolean
  /** Whether there is at least one in-play match anywhere right now
   *  (from /api/matches/calendar). Drives the LIVE pill's tap behaviour:
   *  true → jump to today & filter; false → toast, no filter engaged. */
  hasLiveNow: boolean
  /** Whether the user is currently viewing today's date. When false,
   *  tapping LIVE first snaps them back to today. */
  isOnToday: boolean
  /** Called when LIVE is tapped on a non-today day and live matches
   *  exist — the shell handles the day swap. */
  onGoToToday: () => void
  /** Optional left-side slot for the filter bar (e.g. a "Today" shortcut). */
  leftSlot?: React.ReactNode
}

export default function MatchesFilterClient({
  rootId,
  hasLiveMatches,
  hasLiveNow,
  isOnToday,
  onGoToToday,
  leftSlot,
}: MatchesFilterClientProps) {
  const { filters, setFilters, reset, hydrated, activeCount } = useMatchesFilters()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toastOpen, setToastOpen] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [emptyAfterFilter, setEmptyAfterFilter] = useState(false)
  const lastFiltersRef = useRef<MatchesFilters | null>(null)
  const t = useTranslations('matches')

  const applyFilters = useCallback(() => {
    const root = document.getElementById(rootId)
    if (!root) return

    let visibleMatches = 0

    // 1. Match-level filters (status, category). Status is per-match
    //    (data-status) since the layout interleaves live/upcoming/
    //    finished within each tournament group rather than splitting
    //    them across top-level sections.
    const matchNodes = root.querySelectorAll<HTMLElement>('[data-match]')
    matchNodes.forEach((node) => {
      let hidden = false
      const category = node.getAttribute('data-category')
      const status = node.getAttribute('data-status') ?? ''
      if (filters.category === 'men' && category !== 'men') hidden = true
      if (filters.category === 'women' && category !== 'women') hidden = true
      if (status === 'live' && !filters.status.live) hidden = true
      if (status === 'upcoming' && !filters.status.upcoming) hidden = true
      if (status === 'finished' && !filters.status.finished) hidden = true
      node.style.display = hidden ? 'none' : ''
    })

    // 2. Court-section-level (one per court inside each tournament).
    //    Hide the court header when every match on that court is filtered
    //    out so we don't leave a dangling court row with no matches under
    //    it. Same cascade idea as the old per-status sub-sections.
    //
    //    When the LIVE filter is exclusively active, also hide the
    //    per-court HEADER elements (data-court-header). The court
    //    grouping is noise when the user has narrowed to "show me what's
    //    on right now" — they want a flat list of live matches, not a
    //    breakdown by court.
    const liveOnly =
      filters.status.live && !filters.status.upcoming && !filters.status.finished
    const courtNodes = root.querySelectorAll<HTMLElement>('[data-court-section]')
    courtNodes.forEach((sub) => {
      const matchesInside = sub.querySelectorAll<HTMLElement>('[data-match]')
      let anyVisible = false
      matchesInside.forEach((m) => {
        if (m.style.display !== 'none') anyVisible = true
      })
      sub.style.display = anyVisible ? '' : 'none'
      const header = sub.querySelector<HTMLElement>('[data-court-header]')
      if (header) header.style.display = liveOnly ? 'none' : ''
    })

    // 3. Tournament-group-level (league only). Still hide when every
    //    match inside ended up hidden.
    const groupNodes = root.querySelectorAll<HTMLElement>('[data-tour-group]')
    groupNodes.forEach((group) => {
      let hidden = false
      const league = group.getAttribute('data-league') ?? ''

      if (filters.league === 'premier' && league !== 'premier') hidden = true
      if (filters.league === 'fip' && league !== 'fip') hidden = true

      if (!hidden) {
        const visibleInGroup = group.querySelectorAll<HTMLElement>('[data-match]')
        let anyVisible = false
        visibleInGroup.forEach((m) => {
          if (m.style.display !== 'none') anyVisible = true
        })
        if (!anyVisible) hidden = true
      }
      group.style.display = hidden ? 'none' : ''
    })

    // Count what's actually visible after the cascade.
    matchNodes.forEach((node) => {
      let visible = node.style.display !== 'none'
      if (visible) {
        let cursor: HTMLElement | null = node.parentElement
        while (cursor && cursor !== root) {
          if (cursor.style.display === 'none') {
            visible = false
            break
          }
          cursor = cursor.parentElement
        }
      }
      if (visible) visibleMatches++
    })

    setEmptyAfterFilter(visibleMatches === 0)
  }, [filters, rootId])

  // Re-apply on every filter change, AFTER hydration. Pre-hydration we'd
  // be running with default filters and might briefly show a different
  // view than the server rendered.
  useEffect(() => {
    if (!hydrated) return
    // Cheap shallow ref to skip redundant work if nothing changed (the
    // hook returns a new object reference each render even when values
    // are identical).
    if (lastFiltersRef.current && filtersEqual(lastFiltersRef.current, filters)) {
      return
    }
    lastFiltersRef.current = filters
    applyFilters()
  }, [filters, hydrated, applyFilters])

  // One-tap LIVE toggle. The pill IS the existing status filter — when
  // active it sets {live:true, upcoming:false, finished:false}; when
  // toggled off it restores the all-three-true default. Reusing the
  // status filter (rather than adding a separate boolean) means the
  // drawer checkboxes stay in sync with the bar pill — no two sources
  // of truth.
  const liveActive =
    filters.status.live && !filters.status.upcoming && !filters.status.finished

  const showToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastOpen(true)
    toastTimerRef.current = setTimeout(() => setToastOpen(false), 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  // LIVE behaves as an action, not a dead-end-able filter:
  //   - Already filtered to LIVE only → tap turns it off (back to all).
  //   - Nothing live anywhere → flash a toast, do NOT engage the filter.
  //     We don't want to strand the user on an empty filtered view.
  //   - Live matches exist but user is on another day → jump to today
  //     first, then engage the filter so they land on real content.
  //   - Live exists and user is on today → just engage the filter.
  const handleToggleLive = useCallback(() => {
    if (liveActive) {
      setFilters({
        ...filters,
        status: { live: true, upcoming: true, finished: true },
      })
      return
    }
    if (!hasLiveNow) {
      showToast()
      return
    }
    if (!isOnToday) onGoToToday()
    setFilters({
      ...filters,
      status: { live: true, upcoming: false, finished: false },
    })
  }, [filters, liveActive, hasLiveNow, isOnToday, onGoToToday, setFilters, showToast])

  return (
    <>
      <MatchesFilterBar
        filters={filters}
        activeCount={activeCount}
        onOpen={() => setDrawerOpen(true)}
        onToggleLive={handleToggleLive}
        hasLiveMatches={hasLiveMatches}
        leftSlot={leftSlot}
      />
      <MatchesFilterDrawer
        open={drawerOpen}
        filters={filters}
        onChange={setFilters}
        onReset={reset}
        onClose={() => setDrawerOpen(false)}
      />
      {/* Empty state shown only when filters hide every match. The
          server-rendered "no matches today at all" empty state is a
          separate element; this only fires when the user filtered the
          day's matches into nothing. */}
      {emptyAfterFilter && (
        <div style={{ padding: '8px 16px 24px' }}>
          <EmptyState
            compact
            title={t('filteredEmptyTitle')}
            subtitle={t('filterHint', { league: 'All' })}
            action={
              <button
                type="button"
                onClick={reset}
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
                {t('resetFilters')}
              </button>
            }
          />
        </div>
      )}
      <LiveToast
        open={toastOpen}
        title={t('liveToast.title')}
        subtitle={t('liveToast.sub')}
      />
    </>
  )
}

// Bottom-of-viewport snackbar shown when the user taps LIVE but nothing
// is in play anywhere. Chunky polygon to match the rest of the brand;
// fixed-position with a slide-up entry so it reads as system feedback
// without blocking the page underneath. Auto-dismisses after 3s via the
// parent's setTimeout.
function LiveToast({
  open,
  title,
  subtitle,
}: {
  open: boolean
  title: string
  subtitle: string
}) {
  // Two-state entry transition: render the toast in its "off-screen"
  // resting transform first, then flip `entered` on the next frame so
  // CSS transitions animate it into place. Doing this via state (rather
  // than a @keyframes block) avoids a parse race where the keyframe is
  // registered after the animation property is applied.
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!open) return
    // Two RAFs so the initial style commits before we trigger the
    // transition — a single RAF can collapse to "synchronous final
    // state" in some browsers.
    let id2 = 0
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(id1)
      cancelAnimationFrame(id2)
      setEntered(false)
    }
  }, [open])

  // LiveToast is rendered from a `'use client'` parent and the parent
  // only ever mounts this child when `open` is true (which can only flip
  // true after a user gesture, well after hydration). So we can safely
  // assume `document` exists when we get here.
  if (!open) return null
  const toastNode = (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 88, // sits above the bottom nav
        transform: entered ? 'translate(-50%, 0)' : 'translate(-50%, 12px)',
        opacity: entered ? 1 : 0,
        transition: 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1), opacity 240ms ease-out',
        zIndex: 60,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 16px',
        background: '#1A1A1A',
        border: '1px solid rgba(255,70,85,0.4)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        clipPath: 'polygon(0 8px, 8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px))',
        maxWidth: 'calc(100% - 24px)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'rgba(255,70,85,0.18)',
          border: '1px solid rgba(255,70,85,0.4)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF4655' }} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{title}</span>
        <span style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.4 }}>{subtitle}</span>
      </span>
    </div>
  )
  return createPortal(toastNode, document.body)
}

function filtersEqual(a: MatchesFilters, b: MatchesFilters): boolean {
  if (a.league !== b.league) return false
  if (a.category !== b.category) return false
  if (
    a.status.live !== b.status.live ||
    a.status.upcoming !== b.status.upcoming ||
    a.status.finished !== b.status.finished
  ) return false
  return true
}
