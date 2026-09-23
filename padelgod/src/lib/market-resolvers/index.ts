// The resolver registry.
//
// Operators select a key from this map and fill in parameters; they never
// author SQL. Free-text SQL in an admin panel is how a market silently
// settles wrong and pays out thousands of guacas.
//
// Resolvers are VERSIONED BY KEY. Changing what a resolver means requires a
// new key, because existing markets froze the old one at creation.

import type { Resolver } from './types.js'
import { matchWinnerIsPair } from './match-winner.js'
import { tournamentChampionIsPair } from './tournament-champion.js'

export type { Resolver, ResolverContext, ResolverResult } from './types.js'

export const RESOLVERS: Record<string, Resolver> = {
  'match.winner_is_pair': matchWinnerIsPair,
  'tournament.champion_is_pair': tournamentChampionIsPair,
}

export function listResolverKeys(): string[] {
  return Object.keys(RESOLVERS)
}

export function getResolver(key: string): Resolver {
  const fn = RESOLVERS[key]
  if (!fn) throw new Error(`unknown resolver: ${key}`)
  return fn
}
