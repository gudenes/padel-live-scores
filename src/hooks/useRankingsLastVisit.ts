'use client'
// src/hooks/useRankingsLastVisit.ts
// Tracks the ISO year-week the user last viewed on /rankings.
//
// Storage: localStorage key `rankings_last_visited_week` = "YYYY-WW" string.
// First-time users (no value stored) return null, which makes the
// BottomNav's "latest week !== last visited" comparison true and shows
// the rank-updated dot until they tap RANKING.
//
// Same custom-event sync pattern as useFeedLastVisit — `storage` events
// only fire cross-tab, so a custom `rankings-last-visit-changed` event
// covers same-tab listeners (BottomNav badge reading this hook).

import { useSyncExternalStore } from 'react'

const KEY = 'rankings_last_visited_week'
const EVENT = 'rankings-last-visit-changed'

function getSnapshot(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(KEY)
}

function getServerSnapshot(): null {
  return null
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) callback()
  }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * React hook — returns the user's last-visited rankings ISO year-week
 * (e.g. "2026-21"), or null if they've never visited.
 */
export function useRankingsLastVisit(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Write the given year-week string as the user's last rankings visit
 * and notify any live listeners in the same tab.
 */
export function markRankingsVisited(week: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, week)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: week }))
}
