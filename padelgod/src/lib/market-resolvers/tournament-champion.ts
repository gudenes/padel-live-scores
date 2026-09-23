// tournament.champion_is_pair — "Will {pair} win {tournament}?"
// Settles from the final's winner_pair rather than from
// tournament_projections.status, because the projection worker is a model and
// this must settle on fact.

import type { Resolver } from './types.js'

const DECIDING_STATUSES = new Set(['finished', 'retired'])

function samePair(a1: unknown, a2: unknown, b1: string, b2: string): boolean {
  if (typeof a1 !== 'string' || typeof a2 !== 'string') return false
  // Pair membership is unordered — the draw does not guarantee player order.
  return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1)
}

export const tournamentChampionIsPair: Resolver = async (ctx, params) => {
  const p1 = params.player1Id
  const p2 = params.player2Id
  if (typeof p1 !== 'string' || typeof p2 !== 'string') {
    throw new Error('tournament.champion_is_pair: params.player1Id and player2Id are required')
  }

  const { data, error } = await ctx.supabase
    .from('matches')
    .select('id, status, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .eq('tournament_id', ctx.tournamentId)
    .eq('category', ctx.category)
    // round_canonical, never `round`: the free-text column spells the final at
    // least two ways ('Finals' and 'Final'), so .eq('round','F') never matches.
    .eq('round_canonical', 'F')

  if (error) throw new Error(`tournament.champion_is_pair: ${error.message}`)

  const finals = (data ?? []) as Record<string, unknown>[]
  if (finals.length === 0) return { state: 'undecided' }
  if (finals.length > 1) {
    // Multi-draw events (Games/championship formats) can produce several rows
    // labelled F for one category. Refuse rather than pick one.
    return { state: 'void', reason: `${finals.length} rows with round_canonical='F' — ambiguous final` }
  }

  // Exactly one row survives the length checks above.
  const f = finals[0]!
  const status = f.status as string | null
  const winner = f.winner_pair as number | null

  if (!status || !DECIDING_STATUSES.has(status)) return { state: 'undecided' }
  if (winner !== 1 && winner !== 2) return { state: 'undecided' }

  const won = winner === 1
    ? samePair(f.pair1_player1_id, f.pair1_player2_id, p1, p2)
    : samePair(f.pair2_player1_id, f.pair2_player2_id, p1, p2)

  return {
    state: 'decided',
    outcome: won,
    evidence: { final_match_id: f.id, status, winner_pair: winner, asked_pair: [p1, p2] },
  }
}
