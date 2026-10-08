'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchMatchById } from '@/lib/match-fetch'
import type { Match } from '@/types/match'

/** Detail's own match channel cannot observe a different match's scores. */
export function useSchedulePredecessor(id: string | null) {
  const [snapshot, setSnapshot] = useState<Match | null>(null)
  useEffect(() => {
    if (!id) return
    let cancelled = false, pending: ReturnType<typeof setTimeout> | null = null
    const fetch = async () => {
      const next = await fetchMatchById(supabase, id)
      if (!cancelled) setSnapshot(next)
    }
    const refresh = () => { if (!pending) pending = setTimeout(() => { pending = null; void fetch() }, 500) }
    void fetch()
    const channel = supabase.channel(`schedule-predecessor-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sets', filter: `match_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `match_id=eq.${id}` }, refresh).subscribe()
    const timer = setInterval(refresh, 60_000)
    return () => { cancelled = true; if (pending) clearTimeout(pending); clearInterval(timer); void supabase.removeChannel(channel) }
  }, [id])
  return snapshot?.id === id ? snapshot : null
}
