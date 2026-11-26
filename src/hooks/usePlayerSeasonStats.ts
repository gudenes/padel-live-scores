'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchPlayerSeasonStats, type SeasonStats } from '@/lib/player-season-stats'

export function usePlayerSeasonStats(ids: string[], active: boolean, resultKey: string) {
  const year = new Date().getUTCFullYear()
  const key = [...new Set(ids.filter(Boolean))].sort().join(',')
  const scope = `${year}:${key}:${resultKey}`
  const [state, setState] = useState<{ scope: string; stats: Record<string, SeasonStats>; error: boolean } | null>(null)
  useEffect(() => {
    if (!active || !key) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(refresh, 60_000)
        return
      }
      try {
        const stats = await fetchPlayerSeasonStats(supabase, key.split(','), year, controller.signal)
        if (!controller.signal.aborted) setState({ scope, stats, error: false })
      } catch {
        if (!controller.signal.aborted) setState({ scope, stats: {}, error: true })
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 60_000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [key, year, scope, active])
  return { year, stats: state?.scope === scope ? state.stats : {}, error: state?.scope === scope && state.error }
}
