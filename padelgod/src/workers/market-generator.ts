// market-generator — turns templates × calendar into markets.
//
// Hourly at :25. Flag: ENABLE_MARKET_GENERATOR (default off),
// MARKET_GENERATOR_DRY_RUN (default on).
//
// Spec: docs/superpowers/specs/2026-09-23-prediction-market-design.md

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { bFromMaxLoss, seedShares } from '../lib/lmsr.js'
import { applyCaps, FIXED_SEED_SOURCE, passesGates, type Candidate, type Gates } from '../lib/market-gates.js'
import { matchRowToCandidate, seedSpecForTemplate, type MatchRow } from '../lib/market-candidates.js'
import { isPremierTier } from './match-stats-fetcher.js'
import {
  BAGEL_LINE_RESOLVER,
  bagelLineCopy,
  planBagelLineMarkets,
  type DrawMatchRow,
  type Localized,
} from '../lib/bagel-line.js'

/** Never seed at a probability the CHECK constraint would reject. */
const SEED_MIN = 0.02
const SEED_MAX = 0.98

/**
 * The only `tournaments.status` values that exist, measured in production
 * 2026-09-23: null (643), 'pending' (87), 'finished' (24), 'live' (2).
 * There is no 'ongoing' and no 'upcoming'.
 */
export const TOURNAMENT_STATUSES = ['pending', 'finished', 'live'] as const

/** Statuses a market may be generated for — everything except finished. */
export const ACTIVE_TOURNAMENT_STATUSES = ['pending', 'live'] as const

/**
 * PostgREST `.or()` filter for the above, including NULL.
 * `status.neq.finished` alone would DROP null rows, which are the majority —
 * in SQL, NULL != 'finished' evaluates to NULL, not true.
 */
export const ACTIVE_TOURNAMENT_STATUS_FILTER =
  `status.is.null,${ACTIVE_TOURNAMENT_STATUSES.map((s) => `status.eq.${s}`).join(',')}`

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
  bound_match_id?: string
  question_snapshot?: Localized
  rules_snapshot?: Localized
}

/**
 * Per-market overrides for a template whose markets are not all alike. The
 * bagel line market is one template but each market carries its own line,
 * bound match and fully-rendered copy.
 */
export interface MarketRowExtra {
  resolverParams: Record<string, unknown>
  tokens: Record<string, unknown>
  boundMatchId: string
  question: Localized
  rules: Localized
}

export function buildMarketRow(
  template: GeneratorTemplate,
  candidate: Candidate,
  seasonId: string,
  extra?: MarketRowExtra,
): MarketRow {
  // `seedProb` is the resolved anchor — the model probability for an elo
  // template, the template's own constant for a fixed one. Reading modelProb
  // here instead is what made every fixed-seed market throw (or, upstream in
  // the gate, vanish) while its seed price sat unread in params.
  //
  // `Number.isFinite` rather than a plain null check: an undefined would sail
  // past `=== null` and clamp to NaN, and __tests__ are outside the typecheck
  // scope so TypeScript would not catch a hand-built candidate that omits it.
  const seed = candidate.seedProb
  if (seed === null || !Number.isFinite(seed)) {
    throw new Error(`cannot seed market for ${candidate.key}: no seed probability`)
  }
  if (candidate.scheduledAt === null) {
    throw new Error(`cannot lock market for ${candidate.key}: no scheduled_at`)
  }

  const p = Math.min(SEED_MAX, Math.max(SEED_MIN, seed))
  const b = bFromMaxLoss(template.max_loss_guacas)
  const { qYes, qNo } = seedShares(p, b)

  const row: MarketRow = {
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
  if (extra) {
    row.resolver_params = extra.resolverParams
    row.tokens = extra.tokens
    row.bound_match_id = extra.boundMatchId
    row.question_snapshot = extra.question
    row.rules_snapshot = extra.rules
  }
  return row
}

export interface ExistingMarket {
  template_id: string
  match_id: string | null
  tournament_id: string | null
  category: string | null
  status: string
  created_at: string
  lmsr_b: number | string
}

export interface ExistingTally {
  currentOpen: number
  createdToday: number
  subsidyUsedToday: number
  existingPerMatch: Record<string, number>
  createdPerTournamentToday: Record<string, number>
}

/**
 * Cap inputs from the markets that already exist.
 *
 * A match market stores `tournament_id = NULL` (the scope CHECK allows exactly
 * one of match/tournament), so its tournament must come from the match. The DB
 * guard `play_guard_market_insert` already counts that way; counting only
 * `markets.tournament_id` here made the generator believe a tournament had
 * used 0 of its daily cap, attempt every insert, and log one
 * `tournament_daily_limit` error per candidate per hour (Rotterdam P2,
 * 2026-09-30).
 */
export function tallyExisting(
  existing: ExistingMarket[],
  matchTournament: Map<string, string>,
  startOfDay: Date,
): ExistingTally {
  const t: ExistingTally = {
    currentOpen: 0, createdToday: 0, subsidyUsedToday: 0,
    existingPerMatch: {}, createdPerTournamentToday: {},
  }
  for (const m of existing) {
    if (m.status === 'open') t.currentOpen += 1
    if (m.match_id) t.existingPerMatch[m.match_id] = (t.existingPerMatch[m.match_id] ?? 0) + 1
    if (new Date(m.created_at) >= startOfDay) {
      t.createdToday += 1
      // Real committed subsidy, not an assumed constant: lmsr_b · ln2 is
      // exactly the max_loss_guacas frozen onto the market at creation.
      // PostgREST returns numeric as a string, hence Number().
      t.subsidyUsedToday += Number(m.lmsr_b) * Math.LN2
      const owner = m.tournament_id ?? (m.match_id ? matchTournament.get(m.match_id) : undefined)
      if (owner) t.createdPerTournamentToday[owner] = (t.createdPerTournamentToday[owner] ?? 0) + 1
    }
  }
  return t
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
      .in('horizon', ['pre-match', 'tournament']),
    'templates',
  ) as unknown as (GeneratorTemplate & { gates: Gates; horizon: string })[]

  // Explicit split: other tournament-horizon templates (editorial.*, published
  // by an operator; tournament.outright) are NOT generated here.
  const matchTemplates = templates.filter(t => t.horizon === 'pre-match')
  const lineTemplates = templates.filter(t => t.horizon === 'tournament' && t.resolver_key === BAGEL_LINE_RESOLVER)

  result.templatesConsidered = matchTemplates.length + lineTemplates.length
  if (result.templatesConsidered === 0) return finish()

  const tours = unwrap(
    await deps.supabase
      .from('tournaments').select('id, level, name')
      // `tournaments.status` only ever holds null / 'pending' / 'finished' /
      // 'live' — there is no 'ongoing' or 'upcoming' in this schema, and null
      // is by far the most common (643 of 756 rows). An allow-list of
      // ['live','ongoing','upcoming'] matched only the 2 live rows and made
      // the generator permanently blind to every event that had not started.
      // Verified against production 2026-09-23.
      .or(ACTIVE_TOURNAMENT_STATUS_FILTER),
    'tournaments',
  ) as { id: string; level: string | null; name: string | null }[]

  const premierTours = tours.filter(t => isPremierTier(t.level))
  const premierIds = premierTours.map(t => t.id)
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
      .from('markets').select('template_id, match_id, tournament_id, category, status, created_at, lmsr_b')
      .eq('season_id', season.id),
    'existing markets',
  ) as ExistingMarket[]

  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)

  // Owning tournament of today's match markets — bounded by max_new_per_day.
  const todayMatchIds = [...new Set(existing
    .filter(m => m.match_id && new Date(m.created_at) >= startOfDay)
    .map(m => m.match_id as string))]
  const matchTournament = new Map<string, string>()
  if (todayMatchIds.length > 0) {
    const owners = unwrap(
      await deps.supabase.from('matches').select('id, tournament_id').in('id', todayMatchIds),
      'market match owners',
    ) as { id: string; tournament_id: string | null }[]
    for (const o of owners) if (o.tournament_id) matchTournament.set(o.id, o.tournament_id)
  }

  const existingKeys = new Set(
    existing.filter(m => m.match_id).map(m => `${m.template_id}:${m.match_id}`),
  )
  const existingTournamentKeys = new Set(
    existing.filter(m => m.tournament_id).map(m => `${m.template_id}:${m.tournament_id}:${m.category}`),
  )
  const { currentOpen, createdToday, subsidyUsedToday, existingPerMatch, createdPerTournamentToday } =
    tallyExisting(existing, matchTournament, startOfDay)

  const gateDrops = new Map<string, number>()
  const survivors: { template: GeneratorTemplate; candidate: Candidate; extra?: MarketRowExtra }[] = []
  // applyCaps does not dedup by key, and a candidate with both ids null would
  // bypass the per-match and per-tournament caps entirely. Dedup here.
  const seenKeys = new Set<string>()

  for (const t of matchTemplates) {
    const gates = (t.gates ?? {}) as Gates
    // Resolved once per template, not per row: for a fixed-seed template this
    // reads the constant out of `params` and every candidate opens at it.
    const seed = seedSpecForTemplate(t)
    for (const row of rows) {
      if (existingKeys.has(`${t.id}:${row.id}`)) continue
      const cand = matchRowToCandidate(row, ranks, t.key, t.max_loss_guacas, seed)
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

  // Tournament bagel line markets. Draws are read in full (every status) only
  // for events that still have a future scheduled match — a started draw must
  // be SEEN as started, which the scheduled-only `rows` query cannot show.
  if (lineTemplates.length > 0) {
    const liveIds = [...new Set(rows.map(r => r.tournament_id).filter((id): id is string => !!id))]
    const drawRows = liveIds.length === 0 ? [] : unwrap(
      await deps.supabase
        .from('matches')
        .select('id, tournament_id, category, round_canonical, status, scheduled_at')
        .in('tournament_id', liveIds),
      'draw matches',
    ) as DrawMatchRow[]
    const lineTours = premierTours.filter(t => liveIds.includes(t.id))

    for (const t of lineTemplates) {
      for (const plan of planBagelLineMarkets(t.params, lineTours, drawRows, now)) {
        if (existingTournamentKeys.has(`${t.id}:${plan.tournamentId}:${plan.category}`)) continue
        const cand: Candidate = {
          key: `${t.key}:${plan.tournamentId}:${plan.category}`,
          matchId: null,
          tournamentId: plan.tournamentId,
          category: plan.category,
          round: null,
          bestRanking: null,
          modelProb: null,
          seedSource: FIXED_SEED_SOURCE,
          seedProb: plan.seedProb,
          scheduledAt: plan.locksAt,
          subsidyGuacas: t.max_loss_guacas,
        }
        if (seenKeys.has(cand.key)) continue
        seenKeys.add(cand.key)
        result.candidates += 1
        const copy = bagelLineCopy({ tournamentName: plan.tournamentName, category: plan.category, line: plan.line })
        survivors.push({
          template: t,
          candidate: cand,
          extra: {
            resolverParams: { line: plan.line },
            tokens: { line: String(plan.line), tournament: plan.tournamentName },
            boundMatchId: plan.boundMatchId,
            question: copy.question,
            rules: copy.rules,
          },
        })
      }
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

  for (const { template, candidate, extra } of toCreate) {
    const row = buildMarketRow(template, candidate, season.id as string, extra)
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
