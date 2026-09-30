// Immediate outcomes; payouts and corrections are transactional in Postgres.
import type { ResolverResult } from './market-resolvers/types.js'

/** Kept for existing imports; decided results have no delay. */
export const CONFIRMATION_WINDOW_MS = 0

export interface MarketState {
  // 'held' is persisted and only an operator moves a market out of it.
  status: 'open' | 'locked' | 'proposed' | 'held' | 'settled' | 'void'
  proposedOutcome: boolean | null
  proposedAt: Date | null
  settlesAt: Date | null
}

export type SettlementDecision =
  | { action: 'none' }
  | { action: 'propose'; outcome: boolean; evidence: Record<string, unknown>; settlesAt: Date }
  | { action: 'settle'; outcome: boolean }
  | { action: 'hold'; reason: string }
  | { action: 'void'; reason: string }

export function decideSettlement(
  market: MarketState,
  result: ResolverResult,
  _now: Date,
): SettlementDecision {
  // Only locked and proposed markets are in play. `open` has not stopped
  // trading; settled/void are terminal; 'held' is terminal until an operator
  // intervenes. That last one is the whole safety guarantee: without this
  // short-circuit a held market reverts to auto-settling the moment the
  // upstream answer flaps back to its original value.
  if (market.status !== 'locked' && market.status !== 'proposed') {
    return { action: 'none' }
  }

  if (result.state === 'void') {
    // A refund needs no confirmation window — nobody can be harmed by it.
    // NOTE: a proposed→void transition IS an answer change, but void refunds
    // every position at cost basis, so no user can lose by it. Deliberate.
    return { action: 'void', reason: result.reason }
  }

  if (result.state === 'undecided') return { action: 'none' }
  // Finished + authoritative outcome is sufficient. Corrections are audited
  // delta payments in play_settle_market, never a second full payout.
  return { action: 'settle', outcome: result.outcome }
}
