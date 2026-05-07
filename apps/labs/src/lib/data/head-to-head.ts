// apps/labs/src/lib/data/head-to-head.ts
// Matches between two players on opposing pairs.
// Padel matches have 4 player FKs (pair1_player1/2, pair2_player1/2). H2H means
// player A is on one pair AND player B is on the other pair — never the same pair.

import { supabaseService } from '@/lib/db'
import type { MatchSummary } from './types'
import { rowToMatchSummary } from './player-recent-matches'

const TERMINAL_STATUSES = ['finished', 'retired', 'walkover'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getHeadToHead(
  playerAId: string,
  playerBId: string,
  opts: { limit?: number } = {},
): Promise<MatchSummary[]> {
  if (!UUID_RE.test(playerAId)) throw new Error('invalid playerAId')
  if (!UUID_RE.test(playerBId)) throw new Error('invalid playerBId')
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)
  if (playerAId === playerBId) return []
  const supabase = supabaseService()

  // Fetch all matches where BOTH players appear, then filter to opposing-pair
  // matches in JS — much simpler than encoding the XOR in PostgREST .or().
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, scheduled_at, status, round, winner_pair, tournament_id,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      tournament:tournaments ( name ),
      p1p1:players!matches_pair1_player1_id_fkey ( name ),
      p1p2:players!matches_pair1_player2_id_fkey ( name ),
      p2p1:players!matches_pair2_player1_id_fkey ( name ),
      p2p2:players!matches_pair2_player2_id_fkey ( name ),
      sets ( set_number, set_score )
    `)
    .in('status', TERMINAL_STATUSES as unknown as string[])
    .or(
      `pair1_player1_id.eq.${playerAId},pair1_player2_id.eq.${playerAId},pair2_player1_id.eq.${playerAId},pair2_player2_id.eq.${playerAId}`,
    )
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .limit(500) // pre-filter cap; we'll trim after pair check

  if (error) throw new Error(`getHeadToHead failed: ${error.message}`)
  const rows = data ?? []

  const filtered = rows.filter((r: any) => {
    const inPair1 = (id: string) =>
      r.pair1_player1_id === id || r.pair1_player2_id === id
    const inPair2 = (id: string) =>
      r.pair2_player1_id === id || r.pair2_player2_id === id
    const aInPair1 = inPair1(playerAId)
    const aInPair2 = inPair2(playerAId)
    const bInPair1 = inPair1(playerBId)
    const bInPair2 = inPair2(playerBId)
    if (!(aInPair1 || aInPair2)) return false
    if (!(bInPair1 || bInPair2)) return false
    // Opposing pairs only — exclude same-pair appearances (rare doubles partners change)
    return (aInPair1 && bInPair2) || (aInPair2 && bInPair1)
  })

  return filtered.slice(0, limit).map(rowToMatchSummary)
}
