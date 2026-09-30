import { quoteBuy } from '@/lib/lmsr'
import type { PlayMarket, Side } from './types'

/**
 * What a stake actually buys, quoted from the SAME engine the trade API books
 * against.
 *
 * The earlier trade sheet estimated shares as `stake / price`. That is spot
 * price × amount, and an LMSR market moves as you buy it — so the estimate ran
 * ahead of what the order could execute, and the screen promised a payout
 * larger than the one the user would receive. Quote it properly or not at all.
 *
 * Returns null rather than a guess whenever the market has no book, the stake
 * is not a positive integer, or the curve cannot price the trade. Callers show
 * a dash; nothing downstream has to defend against a fabricated number.
 *
 * `payout` floors the shares because each share settles at exactly 1 G — the
 * rounding has to fall against the user, matching how the engine books it.
 */
export function previewBuy(market: PlayMarket, side: Side, stake: number) {
  if (!market.book || !Number.isSafeInteger(stake) || stake <= 0) return null
  try {
    const { qYes, qNo, b } = market.book
    const quote = quoteBuy(qYes, qNo, b, side, stake)
    if (!Number.isFinite(quote.shares) || quote.shares <= 0) return null
    return { ...quote, payout: Math.floor(quote.shares) }
  } catch {
    return null
  }
}
