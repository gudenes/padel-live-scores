'use client'
// src/hooks/useBookmarks.ts
// Dual-mode bookmark storage:
// - Authenticated: reads/writes user_bookmarks table in Supabase
// - Anonymous: reads/writes localStorage (original behavior)

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'

const STORAGE_KEY = 'pn_bookmarked_matches'

function readLocalStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function writeLocalStorage(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {}
}

export function useBookmarks() {
  const { user } = useAuth()
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  // Load bookmarks on mount or when auth state changes
  useEffect(() => {
    if (user) {
      // Authenticated: fetch from Supabase
      supabase
        .from('user_bookmarks')
        .select('target_id')
        .eq('user_id', user.id)
        .eq('bookmark_type', 'match')
        .then(({ data }) => {
          const ids = new Set((data ?? []).map(r => r.target_id))
          setBookmarked(ids)
          setLoaded(true)
        })
    } else {
      // Anonymous: read localStorage
      setBookmarked(readLocalStorage())
      setLoaded(true)
    }
  }, [user])

  const toggle = useCallback(
    async (matchId: string) => {
      const isCurrentlyBookmarked = bookmarked.has(matchId)

      // Optimistic update
      setBookmarked(prev => {
        const next = new Set(prev)
        if (isCurrentlyBookmarked) next.delete(matchId)
        else next.add(matchId)

        if (!user) writeLocalStorage(next)
        return next
      })

      if (user) {
        if (isCurrentlyBookmarked) {
          await supabase
            .from('user_bookmarks')
            .delete()
            .eq('user_id', user.id)
            .eq('bookmark_type', 'match')
            .eq('target_id', matchId)
        } else {
          await supabase
            .from('user_bookmarks')
            .insert({
              user_id: user.id,
              bookmark_type: 'match',
              target_id: matchId,
            })
        }
      }
    },
    [user, bookmarked],
  )

  const isBookmarked = useCallback(
    (matchId: string) => bookmarked.has(matchId),
    [bookmarked],
  )

  return { isBookmarked, toggle, bookmarked, loaded }
}
