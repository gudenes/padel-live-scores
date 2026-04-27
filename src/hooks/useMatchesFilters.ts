'use client'

// src/hooks/useMatchesFilters.ts
//
// Persistent filter state for the matches page. The filter drawer
// (src/components/MatchesFilterDrawer.tsx) writes here; the filtered list
// (src/components/MatchesFilteredList.tsx) reads.
//
// Two design choices worth calling out:
//
// 1. Single localStorage key. The whole shape is serialised to JSON under
//    one key — keeps reads atomic and avoids the "half-applied" state we'd
//    get with N keys (where one might be stale relative to another). Same
//    pattern as useFeedPreferences.
//
// 2. Sets are stored as arrays. localStorage can't hold Set objects, so
//    `tiers` is rehydrated from an array on read. The hook surfaces the
//    Set form because membership checks are O(1).

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
  /** Empty set = no tier filter (show all tiers). Non-empty = whitelist. */
  tiers: Set<string>
  followedOnly: boolean
  hideQualifiers: boolean
  coverageOnly: boolean
}

export const DEFAULT_FILTERS: MatchesFilters = {
  league: 'all',
  category: 'both',
  status: { live: true, upcoming: true, finished: true },
  tiers: new Set(),
  followedOnly: false,
  hideQualifiers: false,
  coverageOnly: false,
}

interface SerialisedFilters {
  league: LeagueFilter
  category: CategoryFilter
  status: StatusFilter
  tiers: string[]
  followedOnly: boolean
  hideQualifiers: boolean
  coverageOnly: boolean
}

function serialise(f: MatchesFilters): SerialisedFilters {
  return { ...f, tiers: Array.from(f.tiers) }
}

function deserialise(raw: string | null): MatchesFilters {
  if (!raw) return cloneDefault()
  try {
    const parsed = JSON.parse(raw) as Partial<SerialisedFilters>
    return {
      league: parsed.league ?? DEFAULT_FILTERS.league,
      category: parsed.category ?? DEFAULT_FILTERS.category,
      status: { ...DEFAULT_FILTERS.status, ...(parsed.status ?? {}) },
      tiers: new Set(Array.isArray(parsed.tiers) ? parsed.tiers : []),
      followedOnly: parsed.followedOnly ?? false,
      hideQualifiers: parsed.hideQualifiers ?? false,
      coverageOnly: parsed.coverageOnly ?? false,
    }
  } catch {
    return cloneDefault()
  }
}

function cloneDefault(): MatchesFilters {
  return {
    ...DEFAULT_FILTERS,
    status: { ...DEFAULT_FILTERS.status },
    tiers: new Set(),
  }
}

/**
 * Count of "active" filters relative to defaults — drives the small green
 * badge on the Filters button. Each filter group counts as 1 if it's been
 * narrowed from its default.
 *
 * Rationale: a user who has flipped league=premier AND category=men is
 * applying 2 filters, not 4 individual choices.
 */
export function activeFilterCount(f: MatchesFilters): number {
  let n = 0
  if (f.league !== DEFAULT_FILTERS.league) n++
  if (f.category !== DEFAULT_FILTERS.category) n++
  if (!f.status.live || !f.status.upcoming || !f.status.finished) n++
  if (f.tiers.size > 0) n++
  if (f.followedOnly) n++
  if (f.hideQualifiers) n++
  if (f.coverageOnly) n++
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
