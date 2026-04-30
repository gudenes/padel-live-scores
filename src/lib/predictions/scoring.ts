// src/lib/predictions/scoring.ts
//
// Reward + result classification. Pure functions over a stored prediction
// and the current match state.

import type { Match } from '@/types/match'
import { parseSetScore, parseSetFromGames } from '@/types/match'
import { STAKE_GUACAS, MARGIN_BONUS, HEAVY_UPSET_THRESHOLD } from './constants'
import type { Prediction, PredictionResult, Margin, Pair } from './types'

const FINISHED_STATUSES = ['finished', 'ended'] as const
const INVALIDATED_STATUSES = ['walkover', 'retired', 'cancelled'] as const

function isFinished(status: string | null | undefined): boolean {
  return FINISHED_STATUSES.includes(status as any)
}
function isInvalidated(status: string | null | undefined): boolean {
  return INVALIDATED_STATUSES.includes(status as any)
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

/** Classify the result of a prediction against a finished match. Returns
 *  null when the match isn't resolvable yet. */
export function classifyResult(prediction: Prediction, match: Match): PredictionResult | null {
  const status = match.status as string | null | undefined

  if (isInvalidated(status)) return 'invalidated'
  if (!isFinished(status)) return null

  const winner = match.winner_pair as Pair | null | undefined
  if (!winner) return null

  const pickedPair = prediction.pair
  if (pickedPair !== winner) return 'wrong'

  // From here on, pair is correct.
  const actualMargin = getMarginFromMatch(match, winner)
  const marginCorrect = actualMargin !== null && actualMargin === prediction.margin

  // Heavy-upset framing: if the pair the user picked was at or below the
  // upset threshold, render as 'upset' regardless of margin correctness.
  // (Margin still affects the reward — see computeReward.)
  if (prediction.probability <= HEAVY_UPSET_THRESHOLD) return 'upset'

  return marginCorrect ? 'perfect' : 'right'
}

/** Convert classification + the prediction into a guacas reward. */
export function computeReward(
  prediction: Prediction,
  result: PredictionResult,
  marginCorrect: boolean,
): number {
  if (result === 'wrong' || result === 'invalidated') return 0

  const effectiveMultiplier =
    marginCorrect ? prediction.multiplier + MARGIN_BONUS : prediction.multiplier

  return Math.round(STAKE_GUACAS * effectiveMultiplier)
}
