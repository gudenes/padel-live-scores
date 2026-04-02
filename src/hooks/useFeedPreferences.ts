// src/hooks/useFeedPreferences.ts
// Tracks user feed preferences in localStorage for personalized scoring.
// Signals: language affinity, category preference, channel engagement.

import { useState, useCallback, useRef } from 'react'

const STORAGE_KEY = 'padel-feed-prefs'
const MAX_CHANNELS = 100

export interface FeedPrefs {
  /** Click counts per article language (e.g. { en: 12, es: 5 }) */
  langClicks: Record<string, number>
  /** Click counts per category: men vs women */
  catClicks: { men: number; women: number }
  /** Play counts per video channel name */
  channelPlays: Record<string, number>
}

const EMPTY_PREFS: FeedPrefs = {
  langClicks: {},
  catClicks: { men: 0, women: 0 },
  channelPlays: {},
}

function readPrefs(): FeedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_PREFS, catClicks: { ...EMPTY_PREFS.catClicks } }
    const parsed = JSON.parse(raw)
    return {
      langClicks: parsed.langClicks ?? {},
      catClicks: { men: parsed.catClicks?.men ?? 0, women: parsed.catClicks?.women ?? 0 },
      channelPlays: parsed.channelPlays ?? {},
    }
  } catch {
    return { ...EMPTY_PREFS, catClicks: { ...EMPTY_PREFS.catClicks } }
  }
}

function writePrefs(prefs: FeedPrefs) {
  try {
    // Cap channel entries to avoid unbounded growth
    const channels = Object.entries(prefs.channelPlays)
    if (channels.length > MAX_CHANNELS) {
      const sorted = channels.sort((a, b) => b[1] - a[1]).slice(0, MAX_CHANNELS)
      prefs = { ...prefs, channelPlays: Object.fromEntries(sorted) }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

export function useFeedPreferences() {
  const [prefs, setPrefs] = useState<FeedPrefs>(() => readPrefs())
  // Debounce writes — batch rapid updates
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback((next: FeedPrefs) => {
    setPrefs(next)
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => writePrefs(next), 300)
  }, [])

  /** Call when user clicks a news article */
  const trackArticleClick = useCallback((language: string | null, category: string | null) => {
    setPrefs(prev => {
      const next = { ...prev }
      if (language) {
        next.langClicks = { ...prev.langClicks, [language]: (prev.langClicks[language] ?? 0) + 1 }
      }
      if (category === 'men' || category === 'women') {
        next.catClicks = { ...prev.catClicks, [category]: prev.catClicks[category] + 1 }
      }
      persist(next)
      return next
    })
  }, [persist])

  /** Call when user plays a video */
  const trackVideoPlay = useCallback((channelName: string, category: string | null) => {
    setPrefs(prev => {
      const next = { ...prev }
      next.channelPlays = { ...prev.channelPlays, [channelName]: (prev.channelPlays[channelName] ?? 0) + 1 }
      if (category === 'men' || category === 'women') {
        next.catClicks = { ...prev.catClicks, [category]: prev.catClicks[category] + 1 }
      }
      persist(next)
      return next
    })
  }, [persist])

  return { prefs, trackArticleClick, trackVideoPlay }
}
