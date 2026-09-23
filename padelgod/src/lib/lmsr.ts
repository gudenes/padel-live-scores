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

export type Side = 'yes' | 'no'

export interface BuyQuote {
  shares: number
  /** Integer guacas, rounded UP against the user. */
  cost: number
  avgPrice: number
  qYesAfter: number
  qNoAfter: number
}

export interface SellQuote {
  /** Integer guacas, rounded DOWN against the user. */
  refund: number
  avgPrice: number
  qYesAfter: number
  qNoAfter: number
}

/**
 * How many shares `guacas` buys on `side`.
 *
 * Closed form. With a = the current price of the chosen side:
 *   s = b · ln( (e^(G/b) − (1−a)) / a )
 * Derived from C(q+s) − C(q) = G, normalised by (e^(qYes/b) + e^(qNo/b)) so
 * only the price and G/b appear — no large exponentials survive.
 */
export function quoteBuy(
  qYes: number, qNo: number, b: number, side: Side, guacas: number,
): BuyQuote {
  if (!(guacas > 0)) throw new Error(`stake must be > 0, got ${guacas}`)

  const pYes = priceYes(qYes, qNo, b)
  const a = side === 'yes' ? pYes : 1 - pYes

  const shares = b * Math.log((Math.exp(guacas / b) - (1 - a)) / a)
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error(`unpriceable trade: side=${side} guacas=${guacas} price=${a}`)
  }

  const qYesAfter = side === 'yes' ? qYes + shares : qYes
  const qNoAfter  = side === 'no'  ? qNo + shares  : qNo

  // Round the charge UP so rounding can never mint guacas.
  const exact = cost(qYesAfter, qNoAfter, b) - cost(qYes, qNo, b)
  const charged = Math.ceil(exact - 1e-9)

  return { shares, cost: charged, avgPrice: exact / shares, qYesAfter, qNoAfter }
}

/** Refund for selling `shares` back to the maker. */
export function quoteSell(
  qYes: number, qNo: number, b: number, side: Side, shares: number,
): SellQuote {
  if (!(shares > 0)) throw new Error(`shares must be > 0, got ${shares}`)

  const qYesAfter = side === 'yes' ? qYes - shares : qYes
  const qNoAfter  = side === 'no'  ? qNo - shares  : qNo

  // Solvency guard. A naive `shares > qSide` check does NOT work here: seeded
  // q values are NEGATIVE for p < 0.5 (qYes = b·ln p), so q is an offset, not a
  // count of outstanding shares — that check rejects legitimate round-trips.
  //
  // The real invariant is that C(seed) = 0 and C only rises as guacas come in,
  // so C(q) is the maker's cumulative net cash. Letting C go negative would mint
  // guacas that were never paid in, which is exactly what an oversell attempts.
  //
  // Per-USER ownership ("you only hold 12 shares") is not knowable from q alone
  // and belongs to the trade API, which has the position rows.
  const costAfter = cost(qYesAfter, qNoAfter, b)
  if (costAfter < -1e-6) {
    throw new Error(
      `cannot sell ${shares} shares on ${side}: would take the maker below zero ` +
      `(C=${costAfter}), refunding guacas that were never paid in`,
    )
  }

  const exact = cost(qYes, qNo, b) - costAfter
  // Round the refund DOWN, for the same reason buys round up.
  const refund = Math.floor(exact + 1e-9)

  return { refund, avgPrice: exact / shares, qYesAfter, qNoAfter }
}
