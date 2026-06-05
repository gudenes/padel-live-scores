// apps/ops/src/app/(app)/today/_lib/useScoreboard.ts
// Keeps the Today scoreboard fresh: subscribes to match_live_odds Realtime (anon key,
// same approach as the /odds LiveNowSection island), re-fetches the operator-gated
// snapshot route on any change, and polls every 30s so just-finished matches drop out.
// Tracks a coarse ConnectionState that drives the banner + frozen UI treatment.
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { LiveOddsSnapshot, ConnectionState } from './types'

export function useScoreboard(initial: LiveOddsSnapshot, dateIso: string) {
  const [snapshot, setSnapshot] = useState(initial)
  const [connection, setConnection] = useState<ConnectionState>('live')
  const active = useRef(true)
  // Bump to force a re-load (used by the banner retry).
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    active.current = true
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    )

    const load = async () => {
      try {
        const res = await fetch(`/api/internal/today-scoreboard?date=${dateIso}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as LiveOddsSnapshot
        if (active.current) {
          setSnapshot(data)
          setConnection('live')
        }
      } catch {
        if (active.current) setConnection('reconnecting')
      }
    }

    const ch = supabase
      .channel('today_live_odds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_live_odds' }, load)
      .subscribe((status) => {
        if (!active.current) return
        if (status === 'SUBSCRIBED') setConnection('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('offline')
      })

    // A manual retry should attempt an immediate fresh load.
    if (reloadKey > 0) load()

    const poll = setInterval(load, 30_000)

    return () => {
      active.current = false
      clearInterval(poll)
      supabase.removeChannel(ch)
    }
  }, [dateIso, reloadKey])

  return { snapshot, connection, reload }
}
