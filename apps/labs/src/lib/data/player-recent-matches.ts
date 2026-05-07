// apps/labs/src/lib/data/player-recent-matches.ts
// Last N completed matches for a single player. Joins all 4 player FKs +
// tournament + sets in a single query, formats sets into a "6-3, 4-6, 7-5" array.

import { supabaseService } from '@/lib/db'
import type { MatchSummary } from './types'

const TERMINAL_STATUSES = ['finished', 'retired', 'walkover'] as const

export async function getPlayerRecentMatches(
  playerId: string,
  opts: { limit?: number } = {},
): Promise<MatchSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 25)
  const supabase = supabaseService()

  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, scheduled_at, status, round, winner_pair, tournament_id,
      tournament:tournaments ( name ),
      p1p1:players!matches_pair1_player1_id_fkey ( name ),
      p1p2:players!matches_pair1_player2_id_fkey ( name ),
      p2p1:players!matches_pair2_player1_id_fkey ( name ),
      p2p2:players!matches_pair2_player2_id_fkey ( name ),
      sets ( set_number, set_score )
    `)
    .or(
      `pair1_player1_id.eq.${playerId},pair1_player2_id.eq.${playerId},pair2_player1_id.eq.${playerId},pair2_player2_id.eq.${playerId}`,
    )
    .in('status', TERMINAL_STATUSES as unknown as string[])
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw new Error(`getPlayerRecentMatches failed: ${error.message}`)
  return (data ?? []).map(rowToMatchSummary)
}

// Exported for reuse in head-to-head.ts
export function rowToMatchSummary(row: any): MatchSummary {
  const sets: Array<{ set_number: number; set_score: string | null }> = row.sets ?? []
  const orderedSets = [...sets].sort((a, b) => a.set_number - b.set_number)
  return {
    id: row.id,
    played_at: row.scheduled_at ?? null,
    tournament_id: row.tournament_id ?? null,
    tournament_name: row.tournament?.name ?? null,
    round: row.round ?? null,
    status: row.status,
    pair1: {
      player1_name: row.p1p1?.name ?? null,
      player2_name: row.p1p2?.name ?? null,
    },
    pair2: {
      player1_name: row.p2p1?.name ?? null,
      player2_name: row.p2p2?.name ?? null,
    },
    winner_pair: row.winner_pair ?? null,
    set_scores: orderedSets.map((s) => s.set_score ?? '').filter(Boolean),
  }
}
