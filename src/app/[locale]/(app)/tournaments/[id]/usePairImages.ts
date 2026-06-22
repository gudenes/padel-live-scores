'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface PairImage {
  name: string | null
  country: string | null
  avatarUrl: string | null
  photoUrl: string | null
}

/** Fetches name + headshot + full photo for a set of player ids (public read).
 *  Keyed by a sorted-id string so it only refetches when the id set changes. */
export function usePairImages(playerIds: string[]): Map<string, PairImage> {
  const [map, setMap] = useState<Map<string, PairImage>>(new Map())
  const key = [...playerIds].sort().join(',')
  useEffect(() => {
    if (playerIds.length === 0) { setMap(new Map()); return }
    let cancelled = false
    supabase
      .from('players')
      .select('id, name, display_name, country, avatar_url, photo_url')
      .in('id', playerIds)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.warn('[usePairImages] fetch failed:', error); return }
        const m = new Map<string, PairImage>()
        for (const p of (data ?? []) as Array<{ id: string; name: string | null; display_name: string | null; country: string | null; avatar_url: string | null; photo_url: string | null }>) {
          m.set(p.id, { name: p.display_name ?? p.name, country: p.country, avatarUrl: p.avatar_url, photoUrl: p.photo_url })
        }
        setMap(m)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return map
}
