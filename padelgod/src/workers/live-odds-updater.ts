// live-odds-updater — ~20s worker: for every live match with recent PBP,
// anchors to the latest Elo model_predictions row (or computes a cold-start
// ELo anchor from FIP rankings), reads the live score, runs computeLiveProb,
// and upserts match_live_odds + a snapshot row.

import type { SchedulerDeps } from '../scheduler.js'
import { computeLiveProb } from '../lib/inplay-odds.js'
import { buildScoreState, type SetRow } from '../lib/live-score-state.js'
import { fipPriorElo, pairWinProbability, toDecimal } from '../lib/elo-model.js'

const LIVE = ['live', 'on_court', 'break']
const PBP_RECENCY_MS = 2 * 60 * 1000

interface MatchRow {
  id: string; status: string
  pair1_player1_id: string | null; pair1_player2_id: string | null
  pair2_player1_id: string | null; pair2_player2_id: string | null
}

export async function runLiveOddsUpdater(deps: SchedulerDeps): Promise<{
  updated: number; model: number; coldStart: number; skippedNoPbp: number; errors: number
}> {
  const { supabase, logger } = deps
  let updated = 0, model = 0, coldStart = 0, skippedNoPbp = 0, errors = 0

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id,status,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id')
    .in('status', LIVE)
    .returns<MatchRow[]>()
  if (error) { logger.error({ worker: 'live-odds-updater', error: error.message }, 'live match query failed'); return { updated, model, coldStart, skippedNoPbp, errors: 1 } }

  const cutoff = new Date(Date.now() - PBP_RECENCY_MS).toISOString()
  for (const m of matches ?? []) {
    try {
      const { count } = await supabase.from('match_points')
        .select('point_number', { count: 'exact', head: true })
        .eq('match_id', m.id).gte('created_at', cutoff)
      if ((count ?? 0) === 0) { skippedNoPbp++; continue }

      const { data: mp } = await supabase.from('model_predictions')
        .select('id,pair1_prob').eq('match_id', m.id).order('created_at', { ascending: false }).limit(1)
      let anchorPair1: number
      let anchorSource: 'model-prediction' | 'cold-start-elo'
      let anchorId: string | null = null
      if (mp && mp[0]) {
        anchorPair1 = mp[0].pair1_prob as number
        anchorSource = 'model-prediction'
        anchorId = mp[0].id as string
      } else {
        anchorPair1 = await coldStartAnchor(supabase, m)
        anchorSource = 'cold-start-elo'
      }

      const { data: sets } = await supabase.from('sets')
        .select('pair1_games,pair2_games,is_current').eq('match_id', m.id).order('set_number', { ascending: true })
      const { data: games } = await supabase.from('games')
        .select('game_score,is_current').eq('match_id', m.id).eq('is_current', true).limit(1)
      const score = buildScoreState((sets ?? []) as SetRow[], games && games[0] ? { game_score: games[0].game_score as string | null } : null)

      const p1 = computeLiveProb(anchorPair1, score)
      const p2 = 1 - p1
      const coverage = games && games[0] && games[0].game_score ? 'live-pbp' : 'live-coarse'

      await supabase.from('match_live_odds').upsert({
        match_id: m.id,
        pair1_prob: p1, pair2_prob: p2,
        pair1_decimal_odds: round3(toDecimal(p1)), pair2_decimal_odds: round3(toDecimal(p2)),
        anchor_source: anchorSource, anchor_prediction_id: anchorId,
        coverage, model_version: 'inplay-v1', computed_at: new Date().toISOString(),
      }, { onConflict: 'match_id' })
      await supabase.from('match_live_odds_snapshots').insert({ match_id: m.id, pair1_prob: p1 })

      updated++
      if (anchorSource === 'model-prediction') model++; else coldStart++
    } catch (e) {
      errors++
      logger.warn({ worker: 'live-odds-updater', matchId: m.id, err: String(e) }, 'live odds update failed')
    }
  }
  logger.info({ worker: 'live-odds-updater', updated, model, coldStart, skippedNoPbp, errors }, 'live-odds-updater done')
  return { updated, model, coldStart, skippedNoPbp, errors }
}

function round3(x: number): number { return Math.round(x * 1000) / 1000 }

async function coldStartAnchor(supabase: SchedulerDeps['supabase'], m: MatchRow): Promise<number> {
  const ids = [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]
  const ranks = new Map<string, number | null>()
  const present = ids.filter((x): x is string => !!x)
  if (present.length) {
    const { data } = await supabase.from('players').select('id,ranking').in('id', present)
    for (const p of data ?? []) ranks.set(p.id as string, (p.ranking as number | null) ?? null)
  }
  const elo = (id: string | null) => fipPriorElo(id ? ranks.get(id) ?? null : null)
  const pair1Elo = (elo(m.pair1_player1_id) + elo(m.pair1_player2_id)) / 2
  const pair2Elo = (elo(m.pair2_player1_id) + elo(m.pair2_player2_id)) / 2
  return pairWinProbability(pair1Elo, pair2Elo)
}
