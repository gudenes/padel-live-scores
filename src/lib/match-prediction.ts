// src/lib/match-prediction.ts
// Pure derivation of the user-facing prediction read from a Match's
// denormalized pred_pair1_prob. Single source of truth for "who does the
// model favor and by how much" across the match card + detail widget.
export interface MatchPrediction {
  /** Which pair the model favors. */
  favored: 1 | 2
  /** Win probability of the FAVORED pair, as a whole-number percent (50..100). */
  pct: number
  /** Raw pair-1 probability (0..1). */
  pair1Prob: number
}

export function getMatchPrediction(
  match: { pred_pair1_prob?: number | string | null },
): MatchPrediction | null {
  // `pred_pair1_prob` is a Postgres `numeric`; PostgREST returns it as a string
  // (and the worker writes it via `toFixed(4)`). Coerce at the DB boundary
  // before the null/NaN guard and comparison.
  const raw = match.pred_pair1_prob
  if (raw == null) return null
  const p = Number(raw)
  if (Number.isNaN(p)) return null
  const favored: 1 | 2 = p >= 0.5 ? 1 : 2
  const favoredProb = favored === 1 ? p : 1 - p
  return { favored, pct: Math.round(favoredProb * 100), pair1Prob: p }
}
