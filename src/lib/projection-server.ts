// src/lib/projection-server.ts
// Server-only data access for the projection routes. Uses the service
// client (RLS-bypassing) the rest of the SSR layer uses. Read-only.
// Note: `server-only` package is not installed; import omitted.

import { cache } from 'react'
import { createServerClient } from '@/lib/supabase'
import { fetchFeatureFlag, resolveFlag, FLAG_KEYS } from '@/lib/feature-flags'
import type { ProjectionRow } from '@/lib/projection-types'

export type ProjectionCategory = 'men' | 'women'

export interface ProjectionTournamentMeta {
  id: string
  name: string | null
  country: string | null
  level: string | null
  cover_image_url: string | null
  venue: string | null
  starts_at: string | null
  ends_at: string | null
  round_schedule: Record<string, string> | null
}

const PROJECTION_COLUMNS =
  'tournament_id, category, pair_key, pair_player_ids, tournament_level, status, eliminated_round, champion_prob, finalist_prob, semifinal_prob, rounds, predicted_finish_round, computed_at'

/** Server-side projection feature flag (production column; SSR is treated as production). */
export const isProjectionEnabledServer = cache(async (): Promise<boolean> => {
  try {
    const supabase = createServerClient()
    const row = await fetchFeatureFlag(supabase, FLAG_KEYS.PROJECTION_ENABLED)
    return resolveFlag(row)
  } catch {
    return false
  }
})

/** All projection rows for a tournament+category, ordered by champion_prob desc. */
export const fetchProjectionRows = cache(async (
  tournamentId: string,
  category: ProjectionCategory,
): Promise<ProjectionRow[]> => {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tournament_projections')
    .select(PROJECTION_COLUMNS)
    .eq('tournament_id', tournamentId)
    .eq('category', category)
    .order('champion_prob', { ascending: false })
  if (error) {
    console.warn('[projection-server] fetchProjectionRows failed:', error)
    return []
  }
  return (data ?? []) as ProjectionRow[]
})

/** Which categories actually have projection rows (for default-gender + sitemap). */
export const fetchProjectionCategories = cache(async (tournamentId: string): Promise<ProjectionCategory[]> => {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tournament_projections')
    .select('category')
    .eq('tournament_id', tournamentId)
  if (error || !data) return []
  const set = new Set<ProjectionCategory>()
  for (const r of data as { category: ProjectionCategory }[]) set.add(r.category)
  // men first when both present
  return (['men', 'women'] as ProjectionCategory[]).filter((c) => set.has(c))
})

/**
 * Player display names keyed by id, for the given player ids.
 *
 * Chunks the `.in()` lookup (200 ids/batch) so it scales to the sitemap's
 * cross-tournament id set — a single `.in()` with ~1k UUIDs overflows
 * PostgREST's request-URL length, errors out, and would silently yield an
 * empty map (every pair then degrading to an ugly UUID slug).
 */
export async function fetchPlayerNames(playerIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const ids = [...new Set(playerIds)].filter(Boolean)
  if (ids.length === 0) return map
  const supabase = createServerClient()
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('players')
      .select('id, name, display_name')
      .in('id', batch)
    if (error || !data) continue
    for (const p of data as { id: string; name: string | null; display_name: string | null }[]) {
      map.set(p.id, p.display_name ?? p.name ?? p.id)
    }
  }
  return map
}

/** Tournament meta for the projection header + metadata. Null when not found. */
export const fetchProjectionTournamentMeta = cache(async (
  tournamentId: string,
): Promise<ProjectionTournamentMeta | null> => {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, country, level, cover_image_url, venue, starts_at, ends_at, round_schedule')
    .eq('id', tournamentId)
    .single()
  if (error || !data) return null
  return data as ProjectionTournamentMeta
})
