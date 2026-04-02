// src/hooks/useHiddenFeedItems.ts
// Persists hidden feed items (videos + news) in localStorage.
// Items can be hidden by ID; hidden state is shared across home and feed pages.

import { useState, useCallback } from 'react'

const STORAGE_KEY = 'padel-hidden-feed'
const MAX_ITEMS = 500

function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function writeHidden(ids: Set<string>) {
  try {
    // Keep only latest MAX_ITEMS to avoid unbounded growth
    const arr = [...ids].slice(-MAX_ITEMS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  } catch { /* ignore */ }
}

export function useHiddenFeedItems() {
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden())

  const hide = useCallback((id: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.add(id)
      writeHidden(next)
      return next
    })
  }, [])

  const unhide = useCallback((id: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.delete(id)
      writeHidden(next)
      return next
    })
  }, [])

  const isHidden = useCallback((id: string) => hidden.has(id), [hidden])

  return { hidden, hide, unhide, isHidden }
}
