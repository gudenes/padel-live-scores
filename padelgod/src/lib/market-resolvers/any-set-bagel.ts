// match.any_set_bagel — "Will any set finish 6-0?"
//
// Settles from `public.sets`, never from `games` — see the header of
// match-sets.ts for why game-level data would answer wrong for ~97% of
// matches, and for the truncation rule this resolver applies.
//
// RETIREMENT RULE (the short version; the reasoning is in match-sets.ts):
// a bagel that already happened is a fact a retirement cannot undo, so a
// retired match with a 6-0 on the board settles YES. A retired match WITHOUT
// one voids instead of settling NO, because the sets that never got played are
// exactly the ones that might have produced the 6-0.

import type { Resolver } from './types.js'
import {
  classifyStatus,
  isBagel,
  loadSets,
  scorelineLooksComplete,
  setsEvidence,
} from './match-sets.js'

const KEY = 'match.any_set_bagel'

export const matchAnySetBagel: Resolver = async (ctx) => {
  const { data, error } = await ctx.supabase
    .from('matches')
    .select('status')
    .eq('id', ctx.matchId)
    .maybeSingle()

  if (error) throw new Error(`${KEY}: ${error.message}`)
  if (!data) return { state: 'void', reason: 'match row no longer exists' }

  const status = (data as { status: string | null }).status
  const shape = classifyStatus(status)

  // Never answer from a match still in play, even though a 6-0 already on the
  // board is technically unanswerable-no-longer. Settlement runs a 30-minute
  // confirmation window on a LOCKED market; proposing mid-match would burn
  // that window while the scoreline can still be rewritten by the reconciler.
  if (shape === 'in_progress') return { state: 'undecided' }

  const sets = await loadSets(ctx, KEY)
  const bagels = sets.filter(isBagel)

  if (bagels.length > 0) {
    return {
      state: 'decided',
      outcome: true,
      evidence: {
        status,
        sets: setsEvidence(sets),
        bagel_sets: bagels.map((s) => s.setNumber),
      },
    }
  }

  // No bagel, and the match will never produce one. Whether that is a NO or a
  // refund turns entirely on whether the match was allowed to finish.
  if (shape === 'truncated') {
    return {
      state: 'void',
      reason: `match ${status} with no 6-0 set — the unplayed sets were never given the chance`,
    }
  }

  // Completed. Refuse to assert NO from a scoreline that has not fully landed:
  // the results writers fill `sets` after the match row closes.
  if (!scorelineLooksComplete(sets)) return { state: 'undecided' }

  return {
    state: 'decided',
    outcome: false,
    evidence: { status, sets: setsEvidence(sets), bagel_sets: [] },
  }
}
