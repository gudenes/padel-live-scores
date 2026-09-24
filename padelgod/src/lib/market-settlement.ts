// The propose → confirm → settle decision, as a pure function.
//
// Auto-resolution PROPOSES; settlement happens only after a confirmation
// window. Crionet has marked a match `finished` roughly twenty minutes early
// WITH THE WRONG WINNER, twice at Paris Major. With instant payout, guacas
// would move on a phantom result and we would be clawing balances back from
// users. This window turns an upstream bug into a held row.

import type { ResolverResult } from './market-resolvers/types.js'

/** 30 minutes. Long enough to catch a premature-finish reversal. */
export const CONFIRMATION_WINDOW_MS = 30 * 60 * 1000

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
  now: Date,
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

  // A proposed market with no settles_at can never advance and never reaches
  // the hold path, so it would sit invisible to the operator queue forever.
  // Surface it instead.
  if (market.status === 'proposed' && market.settlesAt === null) {
    return { action: 'hold', reason: 'proposed market has no settles_at — incomplete record' }
  }

  if (result.state === 'undecided') {
    // Going backwards from a proposal means the upstream data moved under us.
    if (market.status === 'proposed') {
      return { action: 'hold', reason: 'resolver became undecided after proposing' }
    }
    return { action: 'none' }
  }

  // result.state === 'decided'
  if (market.status === 'locked') {
    return {
      action: 'propose',
      outcome: result.outcome,
      evidence: result.evidence,
      settlesAt: new Date(now.getTime() + CONFIRMATION_WINDOW_MS),
    }
  }

  // Already proposed. The single most important rule in the pipeline:
  // if the answer has CHANGED, hold forever and never auto-settle.
  if (market.proposedOutcome !== result.outcome) {
    return {
      action: 'hold',
      reason: `resolver answer changed: proposed ${market.proposedOutcome}, now ${result.outcome}`,
    }
  }

  if (market.settlesAt && now.getTime() >= market.settlesAt.getTime()) {
    return { action: 'settle', outcome: result.outcome }
  }

  return { action: 'none' }
}
