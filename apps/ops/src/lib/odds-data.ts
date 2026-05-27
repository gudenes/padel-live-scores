// apps/ops/src/lib/odds-data.ts
// Data layer for /odds pages. All Supabase queries live here.
// Pages are server components that call these and pass results to child
// components.

import { createServiceClient } from './supabase'

export interface MatchPredictionRow {
  match_id: string
  created_at: string
  pair1_prob: number
  pair2_prob: number
  pair1_decimal_odds: number
  pair2_decimal_odds: number
  pair1_team_elo: number
  pair2_team_elo: number
  pair1_team_form: number
  pair2_team_form: number
  model_version: string
}

export interface TournamentPredictionRow {
  tournament_id: string
  category: 'men' | 'women'
  pair_player1_id: string
  pair_player2_id: string
  pair_seed: number | null
  created_at: string
  champ_prob: number
  finalist_prob: number
  semi_prob: number
  team_elo: number
  team_form: number
  entry_round: string
  model_version: string
}

export interface ScoredRow {
  brier_score: number
  log_loss: number
  predicted_prob_winner: number
}

export interface CalibrationKpis {
  totalScored: number
  meanBrier: number | null
  meanLogLoss: number | null
  favoriteHitRate: number | null
}

export function computeCalibrationKpis(rows: ScoredRow[]): CalibrationKpis {
  if (rows.length === 0) {
    return { totalScored: 0, meanBrier: null, meanLogLoss: null, favoriteHitRate: null }
  }
  const meanBrier = rows.reduce((a, r) => a + Number(r.brier_score), 0) / rows.length
  const meanLogLoss = rows.reduce((a, r) => a + Number(r.log_loss), 0) / rows.length
  const favoriteWins = rows.filter((r) => Number(r.predicted_prob_winner) > 0.5).length
  const favoriteHitRate = favoriteWins / rows.length
  return { totalScored: rows.length, meanBrier, meanLogLoss, favoriteHitRate }
}

// Returns the latest match prediction per match_id for matches scheduled on
// a given day (YYYY-MM-DD).
export async function getMatchOddsForDay(dateIso: string) {
  const supabase = createServiceClient()
  const dayStart = `${dateIso}T00:00:00`
  const dayEnd = `${dateIso}T23:59:59`

  const { data: matches } = await supabase
    .from('matches')
    .select(
      'id, tournament_id, category, round, round_canonical, status, scheduled_at, court, court_order, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed',
    )
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .order('scheduled_at')

  if (!matches || matches.length === 0) return []

  // Pull latest prediction per match.
  const matchIds = matches.map((m) => m.id)
  const { data: preds } = await supabase
    .from('model_predictions')
    .select('*')
    .in('match_id', matchIds)
    .order('created_at', { ascending: false })
    .limit(Math.min(9999, matchIds.length * 24))
  const latestByMatch = new Map<string, MatchPredictionRow>()
  for (const p of preds ?? []) {
    if (!latestByMatch.has(p.match_id)) latestByMatch.set(p.match_id, p as MatchPredictionRow)
  }

  return matches.map((m) => ({ match: m, prediction: latestByMatch.get(m.id) ?? null }))
}

type TournamentOutlookRow = TournamentPredictionRow & {
  tournaments: { id: string; name: string; level: string | null; status: string | null; ends_at: string }
}

// Latest tournament predictions per tournament (for landing-page outlook cards).
// Strategy: fetch list of in-scope tournaments first, then per tournament pull
// the latest snapshot set. Keeps the query bounded regardless of how many
// snapshots have accumulated.
export async function getOngoingTournamentOutlooks(): Promise<TournamentOutlookRow[]> {
  const supabase = createServiceClient()
  const nowIso = new Date().toISOString()

  // Step 1: find in-scope tournaments (only those that still have matches to come)
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, level, status, ends_at')
    .gte('ends_at', nowIso)
    .order('starts_at', { ascending: true })

  if (!tournaments || tournaments.length === 0) return []

  // Step 2: per tournament + category, pull the latest snapshot batch in parallel.
  // 64 rows is enough for a 32-pair draw at single-snapshot granularity.
  const fetches = tournaments.flatMap((t) =>
    (['men', 'women'] as const).map(async (category) => {
      const { data: rows } = await supabase
        .from('model_tournament_predictions')
        .select('*')
        .eq('tournament_id', t.id)
        .eq('category', category)
        .order('created_at', { ascending: false })
        .limit(64)
      if (!rows || rows.length === 0) return []
      // Dedup to latest per pair (within this tournament + category).
      const seen = new Set<string>()
      const result: TournamentOutlookRow[] = []
      for (const r of rows) {
        const k = `${r.pair_player1_id}::${r.pair_player2_id}`
        if (seen.has(k)) continue
        seen.add(k)
        result.push({ ...(r as TournamentPredictionRow), tournaments: t })
      }
      return result
    }),
  )
  const results = (await Promise.all(fetches)).flat()
  return results
}

// Calibration page data — raw scored rows within the rolling window.
export async function getCalibrationData(windowDays: number) {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  // Paginate to avoid PostgREST 10k cap silent truncation
  const out: Array<{
    brier_score: number
    log_loss: number
    predicted_prob_winner: number
    scored_at: string
    model_version: string
    match_id: string
  }> = []
  const batch = 1000
  let start = 0
  while (true) {
    const { data } = await supabase
      .from('prediction_scores')
      .select('brier_score, log_loss, predicted_prob_winner, scored_at, model_version, match_id')
      .gte('scored_at', cutoff)
      .range(start, start + batch - 1)
    if (!data || data.length === 0) break
    out.push(...(data as typeof out))
    if (data.length < batch) break
    start += batch
  }
  return out
}

// Data freshness signals (used by ModelFreshnessPanel).
export async function getModelFreshness() {
  const supabase = createServiceClient()
  const { data: latestSnapshot } = await supabase
    .from('model_predictions')
    .select('created_at, training_match_count, model_version')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const cutoff7d = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { count: unscoredFinishedCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('status', ['finished', 'retired', 'walkover'])
    .in('winner_pair', [1, 2])
    .gt('finished_at', cutoff7d)

  // (Slightly approximate — counts ALL finished matches not just in-scope.
  //  Good enough as a health signal; refine if false-positives appear.)

  const latestSnapshotAt = latestSnapshot?.created_at ?? null
  const snapshotAgeMin = latestSnapshotAt
    ? Math.round((Date.now() - new Date(latestSnapshotAt).getTime()) / 60_000)
    : null

  return {
    latestSnapshotAt,
    snapshotAgeMin,
    trainingMatchCount: latestSnapshot?.training_match_count ?? null,
    modelVersion: latestSnapshot?.model_version ?? null,
    unscoredFinishedLast7d: unscoredFinishedCount ?? 0,
  }
}
