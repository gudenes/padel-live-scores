import { describe, it, expect } from 'vitest';
import { computeScoreRow } from '../prediction-scorer.js';
import { MODEL_VERSION } from '../../lib/elo-model.js';

describe('computeScoreRow', () => {
  it('pair1 won, prediction was 0.819 for pair1', () => {
    const row = computeScoreRow({
      prediction_id: 'pred-1',
      match_id: 'match-1',
      pair1_prob: 0.819,
      pair2_prob: 0.181,
      model_version: MODEL_VERSION,
      winner_pair: 1,
    });
    expect(row.actual_winner_pair).toBe(1);
    expect(row.predicted_prob_winner).toBeCloseTo(0.819, 4);
    expect(row.brier_score).toBeCloseTo(0.0328, 3);
    expect(row.log_loss).toBeCloseTo(0.1997, 3);
    expect(row.model_version).toBe(MODEL_VERSION);
    expect(row.match_id).toBe('match-1');
    expect(row.prediction_id).toBe('pred-1');
  });

  it('pair2 won, prediction was 0.181 for pair2 (model was wrong)', () => {
    const row = computeScoreRow({
      prediction_id: 'pred-1',
      match_id: 'match-1',
      pair1_prob: 0.819,
      pair2_prob: 0.181,
      model_version: MODEL_VERSION,
      winner_pair: 2,
    });
    expect(row.actual_winner_pair).toBe(2);
    expect(row.predicted_prob_winner).toBeCloseTo(0.181, 4);
    expect(row.brier_score).toBeCloseTo(0.671, 2);
    expect(row.log_loss).toBeCloseTo(1.710, 2);
  });

  it('perfect prediction: 1.0 for winner → Brier 0, log-loss 0', () => {
    const row = computeScoreRow({
      prediction_id: 'pred-1',
      match_id: 'match-1',
      pair1_prob: 1.0,
      pair2_prob: 0.0,
      model_version: MODEL_VERSION,
      winner_pair: 1,
    });
    expect(row.brier_score).toBeCloseTo(0, 5);
    expect(row.log_loss).toBeCloseTo(0, 5);
  });

  it('zero-prob winner gets clamped (no +Infinity log_loss)', () => {
    const row = computeScoreRow({
      prediction_id: 'pred-1',
      match_id: 'match-1',
      pair1_prob: 1.0,
      pair2_prob: 0.0,
      model_version: MODEL_VERSION,
      winner_pair: 2, // model gave 0% to the actual winner
    });
    expect(Number.isFinite(row.log_loss)).toBe(true);
    expect(row.log_loss).toBeGreaterThan(10);
  });
});
