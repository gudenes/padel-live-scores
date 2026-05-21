'use client'

// src/hooks/useMatchesFilters.ts
//
// Persistent filter state for the matches page. The filter sheet
// (src/components/MatchesFilterSheet.tsx) writes here; the filtered list
// (src/components/MatchesFilteredList.tsx) reads.
//
// Two design choices worth calling out:
//
// 1. Single localStorage key. The whole shape is serialised to JSON under
//    one key — keeps reads atomic and avoids the "half-applied" state we'd
//    get with N keys. Same pattern as useFeedPreferences.
//
// 2. The drawer used to expose tier whitelists + personalised toggles
//    (followedOnly, hideQualifiers, coverageOnly). Those came out
//    2026-05-01 — none of them moved the needle on usability and the
//    league/category/status trio plus the LIVE quick-toggle pill cover
//    the filtering need. The fields are stripped from the state shape;
//    pre-existing localStorage entries that still carry the old fields
//    parse cleanly because deserialise ignores unknown keys.

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'matches:filters:v1'

export type LeagueFilter = 'all' | 'premier' | 'fip'
export type CategoryFilter = 'both' | 'men' | 'women'

export interface StatusFilter {
  live: boolean
  upcoming: boolean
  finished: boolean
}

export interface MatchesFilters {
  league: LeagueFilter
  category: CategoryFilter
  status: StatusFilter
}

export const DEFAULT_FILTERS: MatchesFilters = {
  league: 'all',
  category: 'both',
  status: { live: true, upcoming: true, finished: true },
}

interface SerialisedFilters {
  league: LeagueFilter
  category: CategoryFilter
  status: StatusFilter
}

function serialise(f: MatchesFilters): SerialisedFilters {
  return f
}

function deserialise(raw: string | null): MatchesFilters {
  if (!raw) return cloneDefault()
  try {
    const parsed = JSON.parse(raw) as Partial<SerialisedFilters>
    return {
      league: parsed.league ?? DEFAULT_FILTERS.league,
      category: parsed.category ?? DEFAULT_FILTERS.category,
      status: { ...DEFAULT_FILTERS.status, ...(parsed.status ?? {}) },
    }
  } catch {
    return cloneDefault()
  }
}

function cloneDefault(): MatchesFilters {
  return {
    ...DEFAULT_FILTERS,
    status: { ...DEFAULT_FILTERS.status },
  }
}

/**
 * Count of "active" filters relative to defaults — drives the small green
 * badge on the Filters button.
 */
export function activeFilterCount(f: MatchesFilters): number {
  let n = 0
  if (f.league !== DEFAULT_FILTERS.league) n++
  if (f.category !== DEFAULT_FILTERS.category) n++
  if (!f.status.live || !f.status.upcoming || !f.status.finished) n++
  return n
}

export function useMatchesFilters() {
  // SSR safety — start with defaults; hydrate from localStorage after mount.
  const [filters, setFilters] = useState<MatchesFilters>(cloneDefault)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setFilters(deserialise(window.localStorage.getItem(STORAGE_KEY)))
    setHydrated(true)
  }, [])

  // Persist on every change after hydration. Wrapping the write in a guard
  // prevents the initial defaults overwriting whatever was in storage
  // before the deserialise call ran.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialise(filters)))
    } catch {
      // Storage can be disabled (private mode, quota); silently ignore.
    }
  }, [filters, hydrated])

  const reset = useCallback(() => setFilters(cloneDefault()), [])

  return {
    filters,
    setFilters,
    reset,
    /** True once we've read from localStorage. Components should treat
     *  pre-hydration as "no filters applied" to avoid SSR/CSR mismatch. */
    hydrated,
    activeCount: activeFilterCount(filters),
  }
}
