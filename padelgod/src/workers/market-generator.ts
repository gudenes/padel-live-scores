// market-generator — turns templates × calendar into markets.
//
// Hourly at :25. Flag: ENABLE_MARKET_GENERATOR (default off),
// MARKET_GENERATOR_DRY_RUN (default on).
//
// Spec: docs/superpowers/specs/2026-09-23-prediction-market-design.md

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { bFromMaxLoss, seedShares } from '../lib/lmsr.js'
import { applyCaps, passesGates, type Candidate, type Gates } from '../lib/market-gates.js'
import { matchRowToCandidate, type MatchRow } from '../lib/market-candidates.js'
import { isPremierTier } from './match-stats-fetcher.js'

/** Never seed at a probability the CHECK constraint would reject. */
const SEED_MIN = 0.02
const SEED_MAX = 0.98

export interface GeneratorTemplate {
  id: string
  key: string
  resolver_key: string
  params: Record<string, unknown>
  max_loss_guacas: number
  seed_source: string
  lock_rule: 'match_start' | 'round_first_ball' | 'final_start'
}

export interface MarketRow {
  season_id: string
  template_id: string
  match_id: string | null
  tournament_id: string | null
  category: string | null
  tokens: Record<string, unknown>
  resolver_key: string
  resolver_params: Record<string, unknown>
  lmsr_b: number
  seed_prob: number
  seed_source: string
  q_yes: number
  q_no: number
  status: 'open'
  locks_at: string
}

export function buildMarketRow(
  template: GeneratorTemplate,
  candidate: Candidate,
  seasonId: string,
): MarketRow {
  if (candidate.modelProb === null) {
    throw new Error(`cannot seed market for ${candidate.key}: no model probability`)
  }
  if (candidate.scheduledAt === null) {
    throw new Error(`cannot lock market for ${candidate.key}: no scheduled_at`)
  }

  const p = Math.min(SEED_MAX, Math.max(SEED_MIN, candidate.modelProb))
  const b = bFromMaxLoss(template.max_loss_guacas)
  const { qYes, qNo } = seedShares(p, b)

  return {
    season_id: seasonId,
    template_id: template.id,
    match_id: candidate.matchId,
    tournament_id: candidate.matchId ? null : candidate.tournamentId,
    category: candidate.category,
    tokens: {},
    resolver_key: template.resolver_key,
    resolver_params: template.params,
    lmsr_b: b,
    seed_prob: p,
    seed_source: template.seed_source,
    q_yes: qYes,
    q_no: qNo,
    status: 'open',
    locks_at: candidate.scheduledAt.toISOString(),
  }
}

export interface MarketGeneratorDeps {
  supabase: SupabaseClient
  logger?: Logger
  dryRun: boolean
  now?: () => Date
}

export interface MarketGeneratorResult {
  dryRun: boolean
  templatesConsidered: number
  candidates: number
  gateDrops: { reason: string; count: number }[]
  capDrops: { reason: string; count: number }[]
  created: number
  errors: number
  durationMs: number
}

/** Throw rather than treat a failed query as an empty result. A silent
 *  `data: null` would make a total database outage look like "nothing to do". */
function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`market-generator: ${what}: ${res.error.message}`)
  return (res.data ?? []) as T
}

export async function runMarketGenerator(
  deps: MarketGeneratorDeps,
): Promise<MarketGeneratorResult> {
  const started = Date.now()
  const now = deps.now?.() ?? new Date()
  const log = deps.logger

  const result: MarketGeneratorResult = {
    dryRun: deps.dryRun,
    templatesConsidered: 0,
    candidates: 0,
    gateDrops: [],
    capDrops: [],
    created: 0,
    errors: 0,
    durationMs: 0,
  }
  const finish = () => { result.durationMs = Date.now() - started; return result }

  const seasonRes = await deps.supabase
    .from('market_seasons').select('id').eq('status', 'active').maybeSingle()
  if (seasonRes.error) throw new Error(`market-generator: active season: ${seasonRes.error.message}`)
  const season = seasonRes.data
  if (!season) {
    log?.warn('market-generator: no active season, nothing to do')
    return finish()
  }

  const limitsRes = await deps.supabase.from('market_limits').select('*').maybeSingle()
  if (limitsRes.error) throw new Error(`market-generator: limits: ${limitsRes.error.message}`)
  const limits = limitsRes.data
  if (!limits) throw new Error('market-generator: market_limits row is missing')

  const templates = unwrap(
    await deps.supabase
      .from('market_templates')
      .select('id, key, resolver_key, params, gates, max_loss_guacas, seed_source, lock_rule, horizon')
      .eq('enabled', true)
      .eq('horizon', 'pre-match'),
    'templates',
  ) as unknown as (GeneratorTemplate & { gates: Gates })[]

  result.templatesConsidered = templates.length
  if (templates.length === 0) return finish()

  const tours = unwrap(
    await deps.supabase
      .from('tournaments').select('id, level').in('status', ['live', 'ongoing', 'upcoming']),
    'tournaments',
  ) as { id: string; level: string | null }[]

  const premierIds = tours.filter(t => isPremierTier(t.level)).map(t => t.id)
  if (premierIds.length === 0) return finish()

  const rows = unwrap(
    await deps.supabase
      .from('matches')
      .select('id, tournament_id, category, round, round_canonical, scheduled_at, pred_pair1_prob, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
      .in('tournament_id', premierIds)
      .eq('status', 'scheduled')
      .gt('scheduled_at', now.toISOString()),
    'matches',
  ) as unknown as MatchRow[]

  // Rankings for the gate, in one query rather than per candidate.
  const playerIds = new Set<string>()
  for (const r of rows) {
    for (const id of [r.pair1_player1_id, r.pair1_player2_id, r.pair2_player1_id, r.pair2_player2_id]) {
      if (id) playerIds.add(id)
    }
  }
  const ranks = new Map<string, number>()
  if (playerIds.size > 0) {
    const players = unwrap(
      await deps.supabase.from('players').select('id, ranking').in('id', [...playerIds]),
      'players',
    ) as { id: string; ranking: number | null }[]
    for (const p of players) {
      if (typeof p.ranking === 'number') ranks.set(p.id, p.ranking)
    }
  }

  // Existing markets, for dedup and for the caps.
  const existing = unwrap(
    await deps.supabase
      .from('markets').select('template_id, match_id, tournament_id, status, created_at, lmsr_b')
      .eq('season_id', season.id),
    'existing markets',
  ) as { template_id: string; match_id: string | null; tournament_id: string | null; status: string; created_at: string; lmsr_b: number | string }[]

  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)

  const existingKeys = new Set(
    existing.filter(m => m.match_id).map(m => `${m.template_id}:${m.match_id}`),
  )
  const existingPerMatch: Record<string, number> = {}
  const createdPerTournamentToday: Record<string, number> = {}
  let createdToday = 0
  let subsidyUsedToday = 0
  let currentOpen = 0

  for (const m of existing) {
    if (m.status === 'open') currentOpen += 1
    if (m.match_id) existingPerMatch[m.match_id] = (existingPerMatch[m.match_id] ?? 0) + 1
    if (new Date(m.created_at) >= startOfDay) {
      createdToday += 1
      // Real committed subsidy, not an assumed constant: lmsr_b · ln2 is
      // exactly the max_loss_guacas frozen onto the market at creation.
      // PostgREST returns numeric as a string, hence Number().
      subsidyUsedToday += Number(m.lmsr_b) * Math.LN2
      if (m.tournament_id) {
        createdPerTournamentToday[m.tournament_id] = (createdPerTournamentToday[m.tournament_id] ?? 0) + 1
      }
    }
  }

  const gateDrops = new Map<string, number>()
  const survivors: { template: GeneratorTemplate; candidate: Candidate }[] = []
  // applyCaps does not dedup by key, and a candidate with both ids null would
  // bypass the per-match and per-tournament caps entirely. Dedup here.
  const seenKeys = new Set<string>()

  for (const t of templates) {
    const gates = (t.gates ?? {}) as Gates
    for (const row of rows) {
      if (existingKeys.has(`${t.id}:${row.id}`)) continue
      const cand = matchRowToCandidate(row, ranks, t.key, t.max_loss_guacas)
      if (seenKeys.has(cand.key)) continue
      seenKeys.add(cand.key)
      result.candidates += 1
      const gate = passesGates(cand, gates)
      if (!gate.ok) {
        gateDrops.set(gate.reason, (gateDrops.get(gate.reason) ?? 0) + 1)
        continue
      }
      survivors.push({ template: t, candidate: cand })
    }
  }
  result.gateDrops = [...gateDrops.entries()].map(([reason, count]) => ({ reason, count }))

  const caps = applyCaps(survivors.map(s => s.candidate), {
    maxOpenMarkets: limits.max_open_markets as number,
    currentOpen,
    maxNewPerDay: limits.max_new_per_day as number,
    createdToday,
    maxPerMatch: limits.max_per_match as number,
    existingPerMatch,
    maxPerTournamentDay: limits.max_per_tournament_day as number,
    createdPerTournamentToday,
    maxSubsidyPerDay: limits.max_subsidy_per_day as number,
    subsidyUsedToday: Math.round(subsidyUsedToday),
  })
  result.capDrops = caps.drops

  const keptKeys = new Set(caps.kept.map(c => c.key))
  const toCreate = survivors.filter(s => keptKeys.has(s.candidate.key))

  if (deps.dryRun) {
    log?.info({
      candidates: result.candidates,
      wouldCreate: toCreate.length,
      gateDrops: result.gateDrops,
      capDrops: result.capDrops,
      currentOpen,
      createdToday,
    }, 'market-generator: DRY RUN')
    return finish()
  }

  for (const { template, candidate } of toCreate) {
    const row = buildMarketRow(template, candidate, season.id as string)
    const { error } = await deps.supabase.from('markets').insert(row)
    if (error) {
      // 23505 = the partial unique index caught a concurrent run. Benign.
      if (error.code === '23505') continue
      result.errors += 1
      log?.error({ err: error, key: candidate.key }, 'market-generator: insert failed')
      continue
    }
    result.created += 1
  }

  log?.info({
    created: result.created,
    errors: result.errors,
    gateDrops: result.gateDrops,
    capDrops: result.capDrops,
  }, 'market-generator: done')

  return finish()
}
