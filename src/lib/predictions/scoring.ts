// src/lib/predictions/scoring.ts
//
// Reward + result classification. Pure functions over a stored prediction
// and the current match state.

import type { Match } from '@/types/match'
import { parseSetScore, parseSetFromGames } from '@/types/match'
import { STAKE_GUACAS, MARGIN_BONUS, HEAVY_UPSET_THRESHOLD } from './constants'
import type { Prediction, PredictionResult, Margin, Pair } from './types'

// `ended` is the transitional state where the score may be null and
// `winner_pair` may not yet be inferred (see CLAUDE.md "Match Status
// Lifecycle"). We accept it here as terminal because the second guard
// (`!winner_pair → return null`) filters out the not-yet-resolved cases.
// `cancelled` isn't currently emitted by the pipeline but is reserved for
// future use; treat it the same as walkover/retired.
const FINISHED_STATUSES = ['finished', 'ended'] as const
const INVALIDATED_STATUSES = ['walkover', 'retired', 'cancelled'] as const

function isFinished(status: string | null | undefined): boolean {
  return status != null && (FINISHED_STATUSES as readonly string[]).includes(status)
}
function isInvalidated(status: string | null | undefined): boolean {
  return status != null && (INVALIDATED_STATUSES as readonly string[]).includes(status)
}

/** Resolve the actual margin (2-0 or 2-1) from a finished match's set scores. */
export function getMarginFromMatch(match: Match, winnerPair: Pair): Margin | null {
  const sets = (match.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
  if (sets.length < 2) return null

  let winnerSets = 0
  let loserSets = 0
  for (const s of sets) {
    const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
    const p1 = parsed?.p1 ?? s.pair1_games ?? 0
    const p2 = parsed?.p2 ?? s.pair2_games ?? 0
    if (p1 === p2) continue
    const winnerWonSet = winnerPair === 1 ? p1 > p2 : p2 > p1
    if (winnerWonSet) winnerSets++
    else loserSets++
  }
  if (winnerSets < 2) return null
  return loserSets === 0 ? '2-0' : '2-1'
}

/** Result + the boolean a caller would need to compute the reward.
 *  Bundling them prevents the silent-bug case where a caller forgets to
 *  re-derive `marginCorrect` and passes `false` to `computeReward`. */
export type ClassifiedResult = {
  result: PredictionResult
  marginCorrect: boolean
}

/** Classify the result of a prediction against a finished match. Returns
 *  null when the match isn't resolvable yet (still scheduled/live, or
 *  `status='ended'` without a winner_pair yet). */
export function classifyResult(prediction: Prediction, match: Match): ClassifiedResult | null {
  const status = match.status as string | null | undefined

  if (isInvalidated(status)) return { result: 'invalidated', marginCorrect: false }
  if (!isFinished(status)) return null

  const winner = match.winner_pair as Pair | null | undefined
  if (!winner) return null

  const pickedPair = prediction.pair
  if (pickedPair !== winner) return { result: 'wrong', marginCorrect: false }

  // From here on, pair is correct.
  const actualMargin = getMarginFromMatch(match, winner)
  const marginCorrect = actualMargin !== null && actualMargin === prediction.margin

  // Heavy-upset framing: if the pair the user picked was at or below the
  // upset threshold, render as 'upset' regardless of margin correctness.
  // (Margin still affects the reward — see computeReward.)
  if (prediction.probability <= HEAVY_UPSET_THRESHOLD) {
    return { result: 'upset', marginCorrect }
  }

  return { result: marginCorrect ? 'perfect' : 'right', marginCorrect }
}

/** Convert a classified result + the prediction into a guacas reward.
 *  The classified result already carries `marginCorrect`, so callers
 *  can't accidentally pass the wrong value. */
export function computeReward(prediction: Prediction, classified: ClassifiedResult): number {
  if (classified.result === 'wrong' || classified.result === 'invalidated') return 0

  const effectiveMultiplier = classified.marginCorrect
    ? prediction.multiplier + MARGIN_BONUS
    : prediction.multiplier

  return Math.round(STAKE_GUACAS * effectiveMultiplier)
}
