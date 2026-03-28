'use client'
// src/hooks/useBookmarks.ts
// Stores bookmarked match IDs in localStorage.
// Interface is designed to be swappable with a Supabase-backed implementation
// when user accounts are introduced (just swap the storage layer, keep the hook API).

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'pn_bookmarked_matches'

function readStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function writeStorage(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {}
}

export function useBookmarks() {
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set())

  // Hydrate from storage on mount (client-only)
  useEffect(() => {
    setBookmarked(readStorage())
  }, [])

  const toggle = useCallback((matchId: string) => {
    setBookmarked(prev => {
      const next = new Set(prev)
      if (next.has(matchId)) next.delete(matchId)
      else next.add(matchId)
      writeStorage(next)
      return next
    })
  }, [])

  const isBookmarked = useCallback(
    (matchId: string) => bookmarked.has(matchId),
    [bookmarked],
  )

  return { isBookmarked, toggle, bookmarked }
}
