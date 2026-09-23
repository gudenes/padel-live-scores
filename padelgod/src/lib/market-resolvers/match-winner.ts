// match.winner_is_pair — "Will {pair} win this match?"
// Settles from matches.winner_pair, which is the authoritative signal.
// Deliberately does NOT derive a winner from set scores: score data is
// revisable by fip-results-writer, winner_pair is not.

import type { Resolver } from './types.js'

/** Statuses where a winner exists and the market is meaningful. */
const DECIDING_STATUSES = new Set(['finished', 'retired'])
/** Nobody played. A prediction about how they would play is not answerable. */
const VOID_STATUSES = new Set(['walkover', 'cancelled'])

export const matchWinnerIsPair: Resolver = async (ctx, params) => {
  const pair = params.pair
  if (pair !== 1 && pair !== 2) {
    throw new Error(`match.winner_is_pair: params.pair must be 1 or 2, got ${String(pair)}`)
  }

  const { data, error } = await ctx.supabase
    .from('matches')
    .select('status, winner_pair')
    .eq('id', ctx.matchId)
    .maybeSingle()

  if (error) throw new Error(`match.winner_is_pair: ${error.message}`)
  if (!data) return { state: 'void', reason: 'match row no longer exists' }

  const status = data.status as string | null
  const winner = data.winner_pair as number | null

  if (status && VOID_STATUSES.has(status)) {
    return { state: 'void', reason: `match ${status}` }
  }
  if (!status || !DECIDING_STATUSES.has(status)) return { state: 'undecided' }
  // `finished` with a null winner is a real transient state — wait for it.
  if (winner !== 1 && winner !== 2) return { state: 'undecided' }

  return {
    state: 'decided',
    outcome: winner === pair,
    evidence: { status, winner_pair: winner, asked_pair: pair },
  }
}
