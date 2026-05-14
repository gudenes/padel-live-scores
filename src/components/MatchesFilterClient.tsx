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
import type { LiveChannel } from './YoutubeLiveIndicator'

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
  /** YouTube live broadcasts to surface in the page-level indicator.
   *  Empty array → indicator hidden. Server-rendered; refreshes per nav. */
  liveChannels?: LiveChannel[]
}

export default function MatchesFilterClient({
  rootId,
  hasLiveMatches,
  hasLiveNow,
  isOnToday,
  onGoToToday,
  leftSlot,
  liveChannels = [],
}: MatchesFilterClientProps) {
  const { filters, setFilters, reset, hydrated, activeCount } = useMatchesFilters()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toastOpen, setToastOpen] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref on the LIVE pill so the LiveHint can anchor its fixed-position
  // popup to the button's screen coordinates. We can't use a plain
  // position:absolute child of the bar because the sticky header above
  // has `overflow: hidden` (it clips the horizontal day pills), which
  // would also clip the hint.
  const liveBtnRef = useRef<HTMLButtonElement | null>(null)
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

    // 2. Finished-section divider — hide it when all finished matches in
    //    its tournament group ended up hidden (so we don't render a
    //    "FINISHED · N" label over empty space when the LIVE filter is
    //    on).
    const dividers = root.querySelectorAll<HTMLElement>('[data-finished-section]')
    dividers.forEach((divider) => {
      const group = divider.closest<HTMLElement>('[data-tour-group]')
      if (!group) return
      const finishedMatches = group.querySelectorAll<HTMLElement>('[data-match][data-status="finished"]')
      let anyVisible = false
      finishedMatches.forEach((m) => {
        if (m.style.display !== 'none') anyVisible = true
      })
      divider.style.display = anyVisible ? '' : 'none'
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

  // Mirror the dismiss timing on MatchCard's LateHintPill so the LIVE
  // hint feels like part of the same vocabulary.
  const showToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastOpen(true)
    toastTimerRef.current = setTimeout(() => setToastOpen(false), 4500)
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
        liveButtonRef={liveBtnRef}
        liveChannels={liveChannels}
      />
      <LiveHint
        open={toastOpen}
        title={t('liveToast.title')}
        subtitle={t('liveToast.sub')}
        anchorRef={liveBtnRef}
        onClose={() => setToastOpen(false)}
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
    </>
  )
}

// Small popup hint that drops just below the LIVE pill when the user
// taps it but nothing is in play. Same chunky-polygon "tip sheet"
// pattern as the `may be late` / `starting soon` hints on MatchCard —
// gradient background, accent-tinted inner glow, pop-in animation,
// tap to dismiss. Portaled to <body> with fixed positioning computed
// from the LIVE pill's bounding rect, so it visually reads as inline
// (right under the pill) without being clipped by the sticky header's
// `overflow: hidden`. Auto-dismisses via the parent's setTimeout.
function LiveHint({
  open,
  title,
  subtitle,
  anchorRef,
  onClose,
}: {
  open: boolean
  title: string
  subtitle: string
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  // Two-state entry transition: render the hint in its off-screen
  // resting transform first, then flip `entered` on the next frame so
  // CSS transitions animate it into place. State-driven rather than
  // @keyframes to avoid a parse race when keyframes are inlined.
  const [entered, setEntered] = useState(false)
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const el = anchorRef.current
    if (!el) return
    // Snapshot the LIVE pill's rect on open. Re-snapshot on scroll/
    // resize while open so the hint trails the pill if the sticky
    // header shifts (it shouldn't, but be safe).
    const measure = () => {
      const r = el.getBoundingClientRect()
      setAnchorRect({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    let id2 = 0
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(id1)
      cancelAnimationFrame(id2)
      setEntered(false)
    }
  }, [open, anchorRef])

  if (!open || !anchorRect) return null

  const accent = '#FF4655'
  const node = (
    <div
      role="status"
      aria-live="polite"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
      style={{
        position: 'fixed',
        top: anchorRect.top,
        right: anchorRect.right,
        zIndex: 100,
        maxWidth: 260,
        padding: '10px 12px 10px 14px',
        background: 'linear-gradient(135deg, #1A1A1D 0%, #131316 100%)',
        clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
        boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 0 24px ${accent}10`,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.95)',
        transition: 'opacity 200ms ease-out, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        transformOrigin: 'top right',
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
        <svg
          width={13}
          height={13}
          viewBox="0 0 24 24"
          fill="none"
          stroke={accent}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: accent,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginBottom: 3,
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
        <div style={{ color: '#D8D8DD', fontSize: 11, fontWeight: 500, lineHeight: 1.4 }}>
          {subtitle}
        </div>
      </div>
    </div>
  )
  return createPortal(node, document.body)
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
