// src/lib/predictions/types.ts

export type Pair = 1 | 2
export type Margin = '2-0' | '2-1'

export type PredictionResult =
  | 'perfect'      // pair correct + margin correct, prob > 0.25
  | 'right'        // pair correct, margin wrong
  | 'wrong'        // pair wrong
  | 'upset'        // pair correct AND that pair's prob ≤ 0.25 (precedence over perfect)
  | 'invalidated'  // match cancelled / walkover / retired before locking in

/** Stored prediction record. localStorage in Phase 1; DB row in Phase 2. */
export type Prediction = {
  matchId: string
  pair: Pair
  margin: Margin
  /** Frozen probability the user saw for THEIR chosen pair when locking in. */
  probability: number
  /** Frozen base multiplier (no margin bonus). */
  multiplier: number
  /** True when the model fell back to 50/50 (unranked players). */
  isFallback: boolean
  /** ISO timestamp of when the user locked in. */
  createdAt: string
}

/** Output of the probability function for a match. */
export type ProbabilityResult = {
  p1: number
  p2: number
  isFallback: boolean
}
