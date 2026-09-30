// The resolver registry.
//
// Operators select a key from this map and fill in parameters; they never
// author SQL. Free-text SQL in an admin panel is how a market silently
// settles wrong and pays out thousands of guacas.
//
// Resolvers are VERSIONED BY KEY. Changing what a resolver means requires a
// new key, because existing markets froze the old one at creation.

import { pairReachesRound, otherPairWinsTournament, pairTitleCount, playerReachesRanking } from './selected-beta.js'
import type { Resolver } from './types.js'
import { matchWinnerIsPair } from './match-winner.js'
import { tournamentChampionIsPair } from './tournament-champion.js'
import { matchAnySetBagel } from './any-set-bagel.js'
import { matchWentToThreeSets } from './went-to-three-sets.js'
import { tournamentBagelCountAtLeast } from './bagel-count.js'

export type { Resolver, ResolverContext, ResolverResult } from './types.js'

export const RESOLVERS: Record<string, Resolver> = {
  'tournament.pair_reaches_round_v1': pairReachesRound,
  'tournament.other_pair_wins_v1': otherPairWinsTournament,
  'season.pair_title_count_v1': pairTitleCount,
  'player.reaches_ranking_v1': playerReachesRanking,
  'match.winner_is_pair': matchWinnerIsPair,
  'tournament.champion_is_pair': tournamentChampionIsPair,
  // Set-shape resolvers. Both read `public.sets` and share one truncation
  // rule — see market-resolvers/match-sets.ts.
  'match.any_set_bagel': matchAnySetBagel,
  'match.went_to_three_sets': matchWentToThreeSets,
  // Line market over a whole main draw — see market-resolvers/bagel-count.ts.
  'tournament.bagel_count_at_least_v1': tournamentBagelCountAtLeast,
}

export function listResolverKeys(): string[] {
  return Object.keys(RESOLVERS)
}

export function getResolver(key: string): Resolver {
  const fn = RESOLVERS[key]
  if (!fn) throw new Error(`unknown resolver: ${key}`)
  return fn
}
