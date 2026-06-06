'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface ProjectionHistoryPoint {
  champion_prob: number
  computed_at: string
}

/** Reads a pair's champion-odds series (chronological) for the sparkline. */
export function useProjectionHistory(
  tournamentId: string,
  category: 'men' | 'women',
  pairKey: string | null,
): ProjectionHistoryPoint[] {
  const [points, setPoints] = useState<ProjectionHistoryPoint[]>([])
  useEffect(() => {
    if (!pairKey) { setPoints([]); return }
    let cancelled = false
    supabase
      .from('tournament_projection_snapshots')
      .select('champion_prob, computed_at')
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .eq('pair_key', pairKey)
      .order('computed_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.warn('[useProjectionHistory] fetch failed:', error); setPoints([]); return }
        setPoints((data ?? []) as ProjectionHistoryPoint[])
      })
    return () => { cancelled = true }
  }, [tournamentId, category, pairKey])
  return points
}
