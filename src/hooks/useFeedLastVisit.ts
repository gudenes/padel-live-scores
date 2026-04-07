'use client'
// src/hooks/useFeedLastVisit.ts
// Tracks the last time this user visited the feed page.
//
// Storage: localStorage key `feed_last_visit` = ISO timestamp string.
// Cross-component sync: a custom `feed-last-visit-changed` window event is
// dispatched on writes so listeners in the same tab (BottomNav badge) can
// react immediately — `storage` events only fire across tabs, which is why
// we need this custom event.
//
// Default when never set: 24 hours ago, written to localStorage on first
// read so repeated calls return a stable string reference (required by
// useSyncExternalStore to avoid infinite re-renders).

import { useSyncExternalStore } from 'react'

const KEY = 'feed_last_visit'
const EVENT = 'feed-last-visit-changed'
const DEFAULT_LOOKBACK_HOURS = 24

// Stable SSR default — computed once per module load.
const SSR_DEFAULT = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()

function getSnapshot(): string {
  if (typeof window === 'undefined') return SSR_DEFAULT
  const stored = window.localStorage.getItem(KEY)
  if (stored) return stored
  // Seed so the next getSnapshot call returns the same reference (required
  // by useSyncExternalStore — returning a fresh string every call would
  // trigger infinite re-renders).
  const seed = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()
  window.localStorage.setItem(KEY, seed)
  return seed
}

function getServerSnapshot(): string {
  return SSR_DEFAULT
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
 * React hook — returns the current last-visit ISO string and re-renders
 * when it changes (even from another component in the same tab).
 */
export function useFeedLastVisit(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Write "now" as the user's last feed-visit time and notify any live listeners. */
export function markFeedVisited(): void {
  if (typeof window === 'undefined') return
  const now = new Date().toISOString()
  window.localStorage.setItem(KEY, now)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: now }))
}
