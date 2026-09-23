import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * What a resolver may look at. Deliberately narrow: a resolver reads our own
 * tables and nothing else. No HTTP, no clock beyond `now`, no writes.
 */
export interface ResolverContext {
  supabase: SupabaseClient
  marketId: string
  matchId: string | null
  tournamentId: string | null
  category: 'men' | 'women' | null
  tokens: Record<string, unknown>
  now: Date
}

export type ResolverResult =
  /** Not yet knowable. The market stays locked and is retried. */
  | { state: 'undecided' }
  /** Definite. `evidence` is shown verbatim to the operator. */
  | { state: 'decided'; outcome: boolean; evidence: Record<string, unknown> }
  /** Unresolvable for a structural reason — refund every position. */
  | { state: 'void'; reason: string }

export type Resolver = (
  ctx: ResolverContext,
  params: Record<string, unknown>,
) => Promise<ResolverResult>
