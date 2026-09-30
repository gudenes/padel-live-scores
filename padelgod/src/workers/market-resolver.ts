// Recovery worker: locks due markets and settles authoritative results atomically.
// Match-winner results also settle immediately via the database result trigger.
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

  // Retry failed result events as well, including corrections of paid markets.
  const retries = await deps.supabase.from('market_settlement_retries').select('market_id').limit(BATCH_LIMIT)
  if (retries.error) throw new Error(retries.error.message)
  const retryIds = (retries.data ?? []).map(row => row.market_id as string)
  const { data: pending, error: pendingError } = await deps.supabase
    .from('markets')
    .select('id, status, match_id, tournament_id, category, tokens, resolver_key, resolver_params, proposed_outcome, proposed_at, settles_at, settlement_revision')
    .or(`status.in.(locked,proposed)${retryIds.length ? `,id.in.(${retryIds.join(',')})` : ''}`)
    .neq('status', 'held')
    .limit(BATCH_LIMIT)
  if (pendingError) throw new Error(pendingError.message)

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

      const decision: SettlementDecision = retryIds.includes(m.id) && outcome.state !== 'undecided'
        ? outcome.state === 'void' ? { action: 'void', reason: outcome.reason } : { action: 'settle', outcome: outcome.outcome }
        : decideSettlement(toMarketState(m as never), outcome, now)

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

      if (decision.action === 'settle' || decision.action === 'void') {
        if (outcome.state === 'decided') {
          const saved = await deps.supabase.from('markets').update({ proposed_evidence: outcome.evidence }).eq('id', m.id).eq('settlement_revision', m.settlement_revision)
          if (saved.error) throw new Error(saved.error.message)
        }
        const { error } = await deps.supabase.rpc('play_settle_market', {
          p_market_id: m.id,
          p_outcome: decision.action === 'void' ? 'void' : decision.outcome ? 'yes' : 'no',
          p_reason: decision.action === 'void' ? decision.reason : 'Confirmed resolver result',
          p_actor: 'market-resolver', p_expected_revision: m.settlement_revision,
        })
        if (error) throw new Error(error.message)
        continue
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
