// src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { DrawEntry, PlayerHydration } from '@/components/EntryList'

interface EntryRow {
  category: 'men' | 'women'
  draw_type: string
  seed: number | null
  marker: string | null
  player1_id: string | null
  player2_id: string | null
  player1_name: string | null
  player2_name: string | null
  player1_country: string | null
  player2_country: string | null
  team_points: number | null
}

export interface EntryListState {
  entries: DrawEntry[]
  playerMap: Record<string, PlayerHydration>
  loading: boolean
  error: boolean
}

/**
 * Lightweight probe for whether a tournament has any resolved entries. Drives
 * Entries-tab visibility WITHOUT depending on `entry_list_status` (which is an
 * operator-managed FIP-workflow field that stays 'not_applicable' for Premier
 * events even when padelgod has captured their entry list). The presence of
 * `tournament_entries` rows is the true signal — it's populated for any tier.
 * Pass null to skip the probe (e.g. when the feature flag is off).
 */
export function useHasEntries(tournamentId: string | null): boolean {
  const [hasEntries, setHasEntries] = useState(false)
  useEffect(() => {
    if (!tournamentId) {
      setHasEntries(false)
      return
    }
    let cancelled = false
    supabase
      .from('tournament_entries')
      .select('id')
      .eq('tournament_id', tournamentId)
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setHasEntries((data?.length ?? 0) > 0)
      })
    return () => {
      cancelled = true
    }
  }, [tournamentId])
  return hasEntries
}

/** Reads tournament_entries (RLS public read) + hydrates player avatars/rankings. */
export function useEntryList(tournamentId: string): EntryListState {
  const [state, setState] = useState<EntryListState>({ entries: [], playerMap: {}, loading: true, error: false })

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before async fetch
    setState({ entries: [], playerMap: {}, loading: true, error: false })

    ;(async () => {
      const { data, error } = await supabase
        .from('tournament_entries')
        .select('category, draw_type, seed, marker, player1_id, player2_id, player1_name, player2_name, player1_country, player2_country, team_points')
        .eq('tournament_id', tournamentId)
      if (cancelled) return
      if (error) {
        console.warn('[useEntryList] fetch failed:', error)
        setState({ entries: [], playerMap: {}, loading: false, error: true })
        return
      }
      const rows = (data ?? []) as EntryRow[]

      // Synthesize draw_position: sort by seed (nulls last) then team_points
      // desc, assign an ordinal. This is a display ordinal only — never a real
      // bracket position (there is no draw yet at entry-list time).
      const strength = (r: EntryRow) => (r.seed != null ? r.seed : 1000 - (r.team_points ?? 0) / 1e6)
      const sorted = [...rows].sort((a, b) => strength(a) - strength(b))
      const entries: DrawEntry[] = sorted.map((r, i) => ({
        draw_position: i + 1,
        seed: r.seed,
        marker: r.marker,
        category: r.category,
        player1_name: r.player1_name,
        player1_country: r.player1_country,
        player1_id: r.player1_id,
        player2_name: r.player2_name,
        player2_country: r.player2_country,
        player2_id: r.player2_id,
        team_points: r.team_points,
      }))

      // Hydrate avatars + rankings for the referenced players.
      const ids = Array.from(new Set(rows.flatMap((r) => [r.player1_id, r.player2_id]).filter(Boolean))) as string[]
      const playerMap: Record<string, PlayerHydration> = {}
      if (ids.length > 0) {
        const { data: players } = await supabase.from('players').select('id, avatar_url, ranking').in('id', ids)
        for (const p of (players ?? []) as { id: string; avatar_url: string | null; ranking: number | null }[]) {
          playerMap[p.id] = { avatar_url: p.avatar_url, ranking: p.ranking }
        }
      }
      if (cancelled) return
      setState({ entries, playerMap, loading: false, error: false })
    })()

    return () => { cancelled = true }
  }, [tournamentId])

  return state
}
