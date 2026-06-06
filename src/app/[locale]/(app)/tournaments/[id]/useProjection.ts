'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProjectionRow } from '@/lib/projection-types'

export interface ProjectionState {
  rows: ProjectionRow[]
  loading: boolean
  error: boolean
}

/** Reads tournament_projections (RLS public read) for one tournament+category. */
export function useProjection(tournamentId: string, category: 'men' | 'women'): ProjectionState {
  const [state, setState] = useState<ProjectionState>({ rows: [], loading: true, error: false })

  useEffect(() => {
    let cancelled = false
    setState({ rows: [], loading: true, error: false })
    supabase
      .from('tournament_projections')
      .select('tournament_id, category, pair_key, pair_player_ids, tournament_level, status, eliminated_round, champion_prob, finalist_prob, semifinal_prob, rounds, computed_at')
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .order('champion_prob', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('[useProjection] fetch failed:', error)
          setState({ rows: [], loading: false, error: true })
          return
        }
        setState({ rows: (data ?? []) as ProjectionRow[], loading: false, error: false })
      })
    return () => {
      cancelled = true
    }
  }, [tournamentId, category])

  return state
}
