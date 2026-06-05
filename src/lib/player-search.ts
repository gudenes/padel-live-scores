// src/lib/player-search.ts
//
// Unified player search used by every user-facing search surface. Calls the
// `search_players` RPC (accent / nickname / abbreviation / typo tolerant,
// ranked) and degrades gracefully to the legacy normalized_name + display_name
// ilike query if the RPC is unavailable or errors — so search never hard-fails.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeSearchQuery, playerSearchOr } from '@/lib/search-normalize'

export interface PlayerSearchRow {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  category: 'men' | 'women' | null
  avatar_url: string | null
}

const SELECT = 'id, name, display_name, country, ranking, category, avatar_url'

export async function searchPlayers(
  supabase: SupabaseClient,
  rawQuery: string,
  maxResults: number,
): Promise<PlayerSearchRow[]> {
  const q = rawQuery.trim()
  if (!q) return []

  const { data, error } = await supabase.rpc('search_players', { q, max_results: maxResults })
  if (!error && Array.isArray(data)) return data as PlayerSearchRow[]

  // Fallback: legacy client-side ilike on normalized_name + display_name.
  const norm = normalizeSearchQuery(q)
  if (!norm) return []
  const { data: fb } = await supabase
    .from('players')
    .select(SELECT)
    .or(playerSearchOr(norm))
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(maxResults)
  return (fb ?? []) as PlayerSearchRow[]
}
