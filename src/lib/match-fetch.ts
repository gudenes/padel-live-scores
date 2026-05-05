// src/lib/match-fetch.ts
//
// Shared single-match fetcher. Returns a fully-hydrated Match shape with
// tournament + player joins + sets + games, sorted by set/game number.
// Identical projection to the match-detail page so every realtime
// consumer reads the same fields.
//
// Used by:
//   - useLiveMatch hook (per-card realtime subscription)
//   - match-detail page (initial load + realtime refetch)

import type { SupabaseClient } from '@supabase/supabase-js'
import { hydrateThinPlayers } from './thin-match-player'
import { withTimeout } from './with-timeout'
import type { Match } from '@/types/match'

/**
 * Single-match select projection. Mirrors the match-detail page so any
 * surface routing data through this fetcher gets identical fields.
 *
 * Notes:
 *   - `*` from matches includes pair*_player*_name / _country fallback
 *     columns the populator writes for amateur tiers (resolved by
 *     hydrateThinPlayers).
 *   - tournament fields kept narrow (no logo etc) — extend if a future
 *     consumer needs more.
 *   - sets(*, games(*)) gets every column on both tables; cheap because
 *     a single match has at most 5 sets × ~13 games each.
 */
export const MATCH_FETCH_SELECT = `
  *,
  tournament:tournaments(id, name, starts_at, ends_at, country, timezone, source, level),
  pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  sets(*, games(*))
`

export interface FetchMatchOptions {
  /** Timeout in ms. Defaults to 10s — same as match detail page. */
  timeoutMs?: number
  /** Label used in timeout error messages. */
  label?: string
}

/**
 * Fetch a single match by id with the canonical projection. Returns null
 * on error or when the row doesn't exist. Sets are sorted by set_number,
 * games are sorted by game_number, and thin player slots get hydrated
 * from pair*_player*_name fallback columns.
 */
export async function fetchMatchById(
  supabase: SupabaseClient,
  id: string,
  opts: FetchMatchOptions = {},
): Promise<Match | null> {
  const { timeoutMs = 10_000, label = 'match:fetch' } = opts
  // Joined Supabase result has nested set/game/tournament shapes that
  // the generated row type can't express; cast through unknown is the
  // codebase pattern.
  type MatchRow = {
    sets?: Array<{
      set_number: number | null
      games?: Array<{ game_number: number | null }>
    } & Record<string, unknown>>
  } & Record<string, unknown>

  try {
    const { data, error } = await withTimeout<{ data: MatchRow | null; error: unknown }>(
      supabase
        .from('matches')
        .select(MATCH_FETCH_SELECT)
        .eq('id', id)
        .single() as unknown as Promise<{ data: MatchRow | null; error: unknown }>,
      timeoutMs,
      label,
    )
    if (error || !data) return null
    const sorted = {
      ...data,
      sets: (data.sets ?? [])
        .slice()
        .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
        .map((set) => ({
          ...set,
          games: (set.games ?? [])
            .slice()
            .sort((a, b) => (a.game_number ?? 0) - (b.game_number ?? 0)),
        })),
    }
    // hydrateThinPlayers expects a more specific row shape; cast
    // through unknown — same pattern the call sites in fetch-matches-day
    // and the match-detail page use.
    return hydrateThinPlayers(sorted as unknown as Parameters<typeof hydrateThinPlayers>[0]) as unknown as Match
  } catch (e) {
    console.error('[fetchMatchById] exception:', e)
    return null
  }
}
