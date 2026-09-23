// Logarithmic Market Scoring Rule — the pricing engine for Play markets.
//
// Chosen because the market maker's worst-case loss is bounded and knowable
// BEFORE any trade happens: b·ln(2) for a binary market. That is what makes
// the subsidy budget on the operator's Economy page honest.
//
// Spec: docs/superpowers/specs/2026-09-23-prediction-market-design.md

/** Worst-case maker loss for a binary market with liquidity parameter b. */
export function maxLoss(b: number): number {
  return b * Math.LN2
}

/** Inverse of maxLoss: the operator picks a ceiling, b follows. */
export function bFromMaxLoss(maxLossGuacas: number): number {
  if (!(maxLossGuacas > 0)) throw new Error(`maxLoss must be > 0, got ${maxLossGuacas}`)
  return maxLossGuacas / Math.LN2
}

/**
 * C(q) = b · ln( e^(qYes/b) + e^(qNo/b) )
 *
 * Computed via logsumexp. The naive form overflows float64 once q/b exceeds
 * ~709, which a long-running market reaches easily.
 */
export function cost(qYes: number, qNo: number, b: number): number {
  const a = qYes / b
  const c = qNo / b
  const m = Math.max(a, c)
  return b * (m + Math.log(Math.exp(a - m) + Math.exp(c - m)))
}

/** Current YES price — a numerically stable sigmoid, always in (0,1). */
export function priceYes(qYes: number, qNo: number, b: number): number {
  return 1 / (1 + Math.exp((qNo - qYes) / b))
}

/**
 * Opening share counts that make priceYes exactly `p` at zero cost.
 *
 * qYes = b·ln(p), qNo = b·ln(1−p) ⇒ price = p and C = b·ln(p + 1−p) = 0.
 * Opening at the model's number rather than a blank 0.50 is the whole reason
 * this product has a price to trade against from its first second.
 */
export function seedShares(p: number, b: number): { qYes: number; qNo: number } {
  if (!(p > 0 && p < 1)) throw new Error(`seed probability must be in (0,1), got ${p}`)
  return { qYes: b * Math.log(p), qNo: b * Math.log(1 - p) }
}
