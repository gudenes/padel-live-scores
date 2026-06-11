// src/lib/match-prediction.ts
// Pure derivation of the user-facing prediction read from a Match's
// denormalized pred_pair1_prob. Single source of truth for "who does the
// model favor and by how much" across the match card + detail widget.
import type { Match } from '@/types/match'

export interface MatchPrediction {
  /** Which pair the model favors. */
  favored: 1 | 2
  /** Win probability of the FAVORED pair, as a whole-number percent (50..100). */
  pct: number
  /** Raw pair-1 probability (0..1). */
  pair1Prob: number
}

export function getMatchPrediction(match: Pick<Match, 'pred_pair1_prob'>): MatchPrediction | null {
  const p = match.pred_pair1_prob
  if (p == null || Number.isNaN(p)) return null
  const favored: 1 | 2 = p >= 0.5 ? 1 : 2
  const favoredProb = favored === 1 ? p : 1 - p
  return { favored, pct: Math.round(favoredProb * 100), pair1Prob: p }
}
