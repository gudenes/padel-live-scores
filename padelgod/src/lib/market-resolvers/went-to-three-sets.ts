// match.went_to_three_sets — "Will this match go to 3 sets?"
//
// Settles from `public.sets`, never from `games` — see the header of
// match-sets.ts for why, and for the truncation rule this resolver applies.
//
// RETIREMENT RULE (the short version; the reasoning is in match-sets.ts):
// once a third set has been played the match DID go to three sets, and a
// retirement inside that third set cannot take it back — YES. A match retired
// in set 1 or 2 voids instead of settling NO: a third set was still live as a
// possibility when play stopped, so NO was never actually tested. Note this is
// NOT the same event as a completed straight-sets win, which settles NO.

import type { Resolver } from './types.js'
import {
  classifyStatus,
  loadSets,
  scorelineLooksComplete,
  setsEvidence,
  wasSetPlayed,
} from './match-sets.js'

const KEY = 'match.went_to_three_sets'

/** Best-of-three: the decider is set 3. */
const DECIDING_SET = 3

export const matchWentToThreeSets: Resolver = async (ctx) => {
  const { data, error } = await ctx.supabase
    .from('matches')
    .select('status')
    .eq('id', ctx.matchId)
    .maybeSingle()

  if (error) throw new Error(`${KEY}: ${error.message}`)
  if (!data) return { state: 'void', reason: 'match row no longer exists' }

  const status = (data as { status: string | null }).status
  const shape = classifyStatus(status)

  // Same reason as match.any_set_bagel: do not spend the settlement
  // confirmation window on a match whose scoreline can still be rewritten.
  if (shape === 'in_progress') return { state: 'undecided' }

  const sets = await loadSets(ctx, KEY)

  // Counted by set NUMBER, not by row count: a missing set-2 row must not turn
  // a genuine three-setter into a two-setter.
  const decider = sets.find((s) => s.setNumber >= DECIDING_SET && wasSetPlayed(s))

  if (decider) {
    return {
      state: 'decided',
      outcome: true,
      evidence: { status, sets: setsEvidence(sets), decider_set: decider.setNumber },
    }
  }

  if (shape === 'truncated') {
    return {
      state: 'void',
      reason: `match ${status} before a third set — a decider was still possible when play stopped`,
    }
  }

  // Completed in two sets. Requires a scoreline that actually reads as whole:
  // a 1-1 split with no third-set row is a missing row, not a straight-sets win.
  if (!scorelineLooksComplete(sets)) return { state: 'undecided' }

  return {
    state: 'decided',
    outcome: false,
    evidence: { status, sets: setsEvidence(sets), decider_set: null },
  }
}
