// market-resolver — locks due markets, then proposes and settles outcomes.
//
// Every 5 minutes. Flag: ENABLE_MARKET_RESOLVER (default off),
// MARKET_RESOLVER_DRY_RUN (default on).
//
// Auto-resolution PROPOSES; settlement happens after a confirmation window.
// See lib/market-settlement.ts for why that window exists.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { getResolver } from '../lib/market-resolvers/index.js'
import { decideSettlement, type MarketState, type SettlementDecision } from '../lib/market-settlement.js'

const BATCH_LIMIT = 100

export function toMarketState(row: {
  status: string
  proposed_outcome: boolean | null
  proposed_at: string | null
  settles_at: string | null
}): MarketState {
  return {
    status: row.status as MarketState['status'],
    proposedOutcome: row.proposed_outcome,
    proposedAt: row.proposed_at ? new Date(row.proposed_at) : null,
    settlesAt: row.settles_at ? new Date(row.settles_at) : null,
  }
}

/** Columns to write for a decision, or null when nothing changes. */
export function applyDecisionPatch(
  d: SettlementDecision,
  now: Date,
): Record<string, unknown> | null {
  switch (d.action) {
    case 'propose':
      return {
        status: 'proposed',
        proposed_outcome: d.outcome,
        proposed_evidence: d.evidence,
        proposed_at: now.toISOString(),
        settles_at: d.settlesAt.toISOString(),
      }
    case 'settle':
      return {
        status: 'settled',
        outcome: d.outcome,
        settled_at: now.toISOString(),
        settled_by: 'auto',
      }
    case 'void':
      return {
        status: 'void',
        void_reason: d.reason,
        settled_at: now.toISOString(),
        settled_by: 'auto',
      }
    // A hold PERSISTS. Writing nothing would leave the market at `proposed`,
    // and the next pass would auto-settle it the moment the upstream answer
    // flapped back to its original value — which is the exact incident this
    // mechanism exists to prevent. 'held' is terminal until an operator acts.
    case 'hold':
      return { status: 'held', hold_reason: d.reason }
    case 'none':
      return null
  }
}

export interface MarketResolverDeps {
  supabase: SupabaseClient
  logger?: Logger
  dryRun: boolean
  now?: () => Date
}

export interface MarketResolverResult {
  dryRun: boolean
  locked: number
  proposed: number
  settled: number
  held: number
  voided: number
  undecided: number
  errors: number
  durationMs: number
}

export async function runMarketResolver(
  deps: MarketResolverDeps,
): Promise<MarketResolverResult> {
  const started = Date.now()
  const now = deps.now?.() ?? new Date()
  const log = deps.logger
  const r: MarketResolverResult = {
    dryRun: deps.dryRun, locked: 0, proposed: 0, settled: 0,
    held: 0, voided: 0, undecided: 0, errors: 0, durationMs: 0,
  }

  // Pass A — lock markets whose time has come.
  const { data: due } = await deps.supabase
    .from('markets').select('id')
    .eq('status', 'open').lte('locks_at', now.toISOString()).limit(BATCH_LIMIT)

  for (const m of due ?? []) {
    if (deps.dryRun) { r.locked += 1; continue }
    const { error } = await deps.supabase
      .from('markets').update({ status: 'locked' }).eq('id', m.id).eq('status', 'open')
    if (error) { r.errors += 1; continue }
    r.locked += 1
  }

  // Pass B — resolve locked and proposed markets. 'held' is deliberately NOT
  // in this list: only an operator moves a market out of held.
  const { data: pending } = await deps.supabase
    .from('markets')
    .select('id, status, match_id, tournament_id, category, tokens, resolver_key, resolver_params, proposed_outcome, proposed_at, settles_at')
    .in('status', ['locked', 'proposed'])
    .limit(BATCH_LIMIT)

  for (const m of pending ?? []) {
    try {
      const resolver = getResolver(m.resolver_key as string)
      const outcome = await resolver({
        supabase: deps.supabase,
        marketId: m.id as string,
        matchId: (m.match_id as string | null) ?? null,
        tournamentId: (m.tournament_id as string | null) ?? null,
        category: (m.category as 'men' | 'women' | null) ?? null,
        tokens: (m.tokens ?? {}) as Record<string, unknown>,
        now,
      }, (m.resolver_params ?? {}) as Record<string, unknown>)

      const decision = decideSettlement(toMarketState(m as never), outcome, now)

      switch (decision.action) {
        case 'none':    r.undecided += 1; break
        case 'propose': r.proposed += 1; break
        case 'settle':  r.settled += 1; break
        case 'void':    r.voided += 1; break
        case 'hold':
          r.held += 1
          log?.warn({ marketId: m.id, reason: decision.reason },
            'market-resolver: HELD — needs an operator')
          break
      }

      if (deps.dryRun) continue

      // Phase 1 has no trade API, so no market can have positions. If one
      // does, something is very wrong — fail loudly rather than settle
      // without paying anybody.
      if (decision.action === 'settle' || decision.action === 'void') {
        const { count } = await deps.supabase
          .from('market_positions')
          .select('market_id', { count: 'exact', head: true })
          .eq('market_id', m.id)
        if ((count ?? 0) > 0) {
          throw new Error(
            `market ${m.id} has ${count} positions but payout is not implemented until phase 3`,
          )
        }
      }

      const patch = applyDecisionPatch(decision, now)
      if (!patch) continue

      const { error } = await deps.supabase
        .from('markets').update(patch).eq('id', m.id).eq('status', m.status)
      if (error) r.errors += 1
    } catch (err) {
      r.errors += 1
      log?.error({ err, marketId: m.id }, 'market-resolver: failed')
    }
  }

  log?.info({ ...r }, 'market-resolver: done')
  r.durationMs = Date.now() - started
  return r
}
