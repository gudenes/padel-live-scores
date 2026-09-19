// src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { FieldEntry, PlayerHydration } from '@/lib/entry-field'

interface EntryRow {
  id: string
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
  entries: FieldEntry[]
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

/**
 * Reads tournament_entries (RLS public read) + hydrates player avatars/rankings.
 * Pass null to skip the fetch entirely — correct only when the caller already
 * has another source for pairs and seeds (a non-empty `matches` array). Draw
 * state alone is NOT the condition: the standalone /projection routes pass
 * matches={[]} and still need entries post-draw, since that's their only
 * source of main-draw seeds.
 */
export function useEntryList(tournamentId: string | null): EntryListState {
  const [state, setState] = useState<EntryListState>({ entries: [], playerMap: {}, loading: tournamentId != null, error: false })

  useEffect(() => {
    if (!tournamentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- skip path, no fetch
      setState({ entries: [], playerMap: {}, loading: false, error: false })
      return
    }
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before async fetch
    setState({ entries: [], playerMap: {}, loading: true, error: false })

    ;(async () => {
      const { data, error } = await supabase
        .from('tournament_entries')
        .select('id, category, draw_type, seed, marker, player1_id, player2_id, player1_name, player2_name, player1_country, player2_country, team_points')
        .eq('tournament_id', tournamentId)
      if (cancelled) return
      if (error) {
        console.warn('[useEntryList] fetch failed:', error)
        setState({ entries: [], playerMap: {}, loading: false, error: true })
        return
      }
      const rows = (data ?? []) as EntryRow[]

      // Ordering now lives in `partitionField` (src/lib/entry-field.ts) — the
      // old synthesized `draw_position` ordinal went away with EntryList.
      const entries: FieldEntry[] = rows.map((r) => ({
        id: r.id,
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
