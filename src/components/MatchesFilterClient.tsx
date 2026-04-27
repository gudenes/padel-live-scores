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
import { useTranslations } from 'next-intl'
import { useMatchesFilters, type MatchesFilters } from '@/hooks/useMatchesFilters'
import MatchesFilterBar from './MatchesFilterBar'
import MatchesFilterDrawer from './MatchesFilterDrawer'

const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export interface MatchesFilterClientProps {
  /** ID of the wrapper div the server renders around all match nodes.
   *  Used as the root for visibility toggling. */
  rootId: string
  /** Optional left-side slot for the filter bar (e.g. a "Today" shortcut). */
  leftSlot?: React.ReactNode
}

export default function MatchesFilterClient({ rootId, leftSlot }: MatchesFilterClientProps) {
  const { filters, setFilters, reset, hydrated, activeCount } = useMatchesFilters()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [emptyAfterFilter, setEmptyAfterFilter] = useState(false)
  const lastFiltersRef = useRef<MatchesFilters | null>(null)
  const t = useTranslations('matches')

  const applyFilters = useCallback(() => {
    const root = document.getElementById(rootId)
    if (!root) return

    let visibleMatches = 0

    // 1. Match-level filters (status, category, hideQualifiers, coverage).
    //    Status is now per-match (data-status) since the new layout
    //    interleaves live/upcoming/finished within each tournament group
    //    rather than splitting them across top-level sections.
    const matchNodes = root.querySelectorAll<HTMLElement>('[data-match]')
    matchNodes.forEach((node) => {
      let hidden = false
      const category = node.getAttribute('data-category')
      const status = node.getAttribute('data-status') ?? ''
      if (filters.category === 'men' && category !== 'men') hidden = true
      if (filters.category === 'women' && category !== 'women') hidden = true
      if (filters.hideQualifiers && node.getAttribute('data-qualifier') === '1') hidden = true
      if (filters.coverageOnly && node.getAttribute('data-coverage') !== '1') hidden = true
      if (status === 'live' && !filters.status.live) hidden = true
      if (status === 'upcoming' && !filters.status.upcoming) hidden = true
      if (status === 'finished' && !filters.status.finished) hidden = true
      node.style.display = hidden ? 'none' : ''
    })

    // 2. Sub-section-level (Live Now / Upcoming / Results inside each
    //    tournament). Hide the sub-section when all matches inside are
    //    hidden so we don't leave dangling sub-headers.
    const substatusNodes = root.querySelectorAll<HTMLElement>('[data-substatus]')
    substatusNodes.forEach((sub) => {
      const matchesInside = sub.querySelectorAll<HTMLElement>('[data-match]')
      let anyVisible = false
      matchesInside.forEach((m) => {
        if (m.style.display !== 'none') anyVisible = true
      })
      sub.style.display = anyVisible ? '' : 'none'
    })

    // 3. Tournament-group-level (league, tier). If not blocked by those,
    //    still hide when every match inside ended up hidden.
    const groupNodes = root.querySelectorAll<HTMLElement>('[data-tour-group]')
    groupNodes.forEach((group) => {
      let hidden = false
      const league = group.getAttribute('data-league') ?? ''
      const tier = group.getAttribute('data-tier') ?? ''

      if (filters.league === 'premier' && league !== 'premier') hidden = true
      if (filters.league === 'fip' && league !== 'fip') hidden = true
      if (filters.tiers.size > 0 && !filters.tiers.has(tier)) hidden = true

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

  return (
    <>
      <MatchesFilterBar
        filters={filters}
        activeCount={activeCount}
        onOpen={() => setDrawerOpen(true)}
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
          <div
            style={{
              clipPath: CHUNKY_CARD,
              background: BG_CARD,
              border: `1px solid ${BORDER}`,
              padding: '24px 20px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
              {t('filters.summary.all') /* lightweight reuse */}
            </div>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
              {/* Use the existing filterHint key — it nudges the user to
                  widen their filters, which is exactly what we want here. */}
              {t('filterHint', { league: 'All' })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function filtersEqual(a: MatchesFilters, b: MatchesFilters): boolean {
  if (a.league !== b.league) return false
  if (a.category !== b.category) return false
  if (
    a.status.live !== b.status.live ||
    a.status.upcoming !== b.status.upcoming ||
    a.status.finished !== b.status.finished
  ) return false
  if (a.tiers.size !== b.tiers.size) return false
  for (const t of a.tiers) if (!b.tiers.has(t)) return false
  if (a.followedOnly !== b.followedOnly) return false
  if (a.hideQualifiers !== b.hideQualifiers) return false
  if (a.coverageOnly !== b.coverageOnly) return false
  return true
}
