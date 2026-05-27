// prediction-scorer — scores finished matches against their pre-match snapshot.
// See docs/superpowers/specs/2026-05-27-odds-admin-visibility-design.md §2.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { brierScore, logLoss } from '../lib/elo-model.js';

const LOOKBACK_DAYS = 7;
const BATCH_LIMIT = 200;

export interface PredictionScorerDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** Override "now" for tests. */
  now?: () => Date;
}

export interface PredictionScorerResult {
  scored: number;
  skippedNoSnapshot: number;
  skippedNoScheduledTime: number;
  errors: number;
  durationMs: number;
}

interface ScoreRowInput {
  prediction_id: string;
  match_id: string;
  pair1_prob: number;
  pair2_prob: number;
  model_version: string;
  winner_pair: 1 | 2;
}

export interface ScoreRow {
  prediction_id: string;
  match_id: string;
  actual_winner_pair: 1 | 2;
  predicted_prob_winner: number;
  brier_score: number;
  log_loss: number;
  model_version: string;
}

export function computeScoreRow(input: ScoreRowInput): ScoreRow {
  const winner = input.winner_pair;
  const predicted = winner === 1 ? input.pair1_prob : input.pair2_prob;
  return {
    prediction_id: input.prediction_id,
    match_id: input.match_id,
    actual_winner_pair: winner,
    predicted_prob_winner: predicted,
    brier_score: brierScore(predicted, 1),
    log_loss: logLoss(predicted),
    model_version: input.model_version,
  };
}

export async function runPredictionScorer(
  deps: PredictionScorerDeps,
): Promise<PredictionScorerResult> {
  const { supabase, logger, now = () => new Date() } = deps;
  const startMs = Date.now();
  const cutoffIso = new Date(now().getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();

  // 1. Find unscored finished matches in the last 7 days
  const { data: unscored, error } = await supabase
    .from('matches')
    .select('id, scheduled_at, finished_at, winner_pair')
    .in('status', ['finished', 'retired', 'walkover'])
    .in('winner_pair', [1, 2])
    .gt('finished_at', cutoffIso)
    .limit(BATCH_LIMIT);
  if (error) {
    logger?.error({ err: error }, 'prediction-scorer match query failed');
    return {
      scored: 0,
      skippedNoSnapshot: 0,
      skippedNoScheduledTime: 0,
      errors: 1,
      durationMs: Date.now() - startMs,
    };
  }

  // 2. Filter to those without a prediction_scores row
  const matchIds = (unscored ?? []).map((m) => m.id);
  if (matchIds.length === 0) {
    return {
      scored: 0,
      skippedNoSnapshot: 0,
      skippedNoScheduledTime: 0,
      errors: 0,
      durationMs: Date.now() - startMs,
    };
  }
  const { data: alreadyScored } = await supabase
    .from('prediction_scores')
    .select('match_id')
    .in('match_id', matchIds);
  const scoredIds = new Set((alreadyScored ?? []).map((r) => r.match_id));
  const todo = (unscored ?? []).filter((m) => !scoredIds.has(m.id));

  let scored = 0;
  let skippedNoSnapshot = 0;
  let skippedNoScheduledTime = 0;
  let errors = 0;

  for (const m of todo) {
    try {
      if (!m.scheduled_at) {
        skippedNoScheduledTime++;
        logger?.info(
          { matchId: m.id },
          'no scheduled_at, cannot determine pre-match cutoff — skipping',
        );
        continue;
      }

      // 3. Latest pre-match snapshot
      const { data: snap } = await supabase
        .from('model_predictions')
        .select('id, pair1_prob, pair2_prob, model_version')
        .eq('match_id', m.id)
        .lt('created_at', m.scheduled_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!snap) {
        skippedNoSnapshot++;
        logger?.info({ matchId: m.id }, 'no pre-match snapshot, skipping');
        continue;
      }

      const row = computeScoreRow({
        prediction_id: snap.id,
        match_id: m.id,
        pair1_prob: Number(snap.pair1_prob),
        pair2_prob: Number(snap.pair2_prob),
        model_version: snap.model_version,
        winner_pair: m.winner_pair as 1 | 2,
      });

      // 4. Insert with ON CONFLICT DO NOTHING (race-safe)
      const { error: insErr } = await supabase
        .from('prediction_scores')
        .insert({
          ...row,
          predicted_prob_winner: row.predicted_prob_winner.toFixed(4),
          brier_score: row.brier_score.toFixed(5),
          log_loss: row.log_loss.toFixed(5),
        });
      if (insErr) {
        // Unique-constraint hit (race with concurrent scorer) is acceptable
        if (insErr.code === '23505') continue;
        throw insErr;
      }
      scored++;
    } catch (err) {
      errors++;
      logger?.error({ err, matchId: m.id }, 'scoring failed for match');
    }
  }

  const durationMs = Date.now() - startMs;
  logger?.info(
    { scored, skippedNoSnapshot, skippedNoScheduledTime, errors, durationMs },
    'prediction-scorer complete',
  );
  return { scored, skippedNoSnapshot, skippedNoScheduledTime, errors, durationMs };
}
