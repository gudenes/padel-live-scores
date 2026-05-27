import { describe, it, expect } from 'vitest'
import { computeCalibrationKpis, type ScoredRow } from '../src/lib/odds-data'

describe('computeCalibrationKpis', () => {
  it('handles empty input', () => {
    const k = computeCalibrationKpis([])
    expect(k.totalScored).toBe(0)
    expect(k.meanBrier).toBeNull()
    expect(k.meanLogLoss).toBeNull()
    expect(k.favoriteHitRate).toBeNull()
  })

  it('computes means + favorite hit-rate correctly', () => {
    const rows: ScoredRow[] = [
      { brier_score: 0.04, log_loss: 0.2, predicted_prob_winner: 0.8 }, // favorite won
      { brier_score: 0.49, log_loss: 1.6, predicted_prob_winner: 0.3 }, // underdog won
      { brier_score: 0.01, log_loss: 0.1, predicted_prob_winner: 0.9 }, // favorite won
      { brier_score: 0.04, log_loss: 0.2, predicted_prob_winner: 0.8 }, // favorite won
    ]
    const k = computeCalibrationKpis(rows)
    expect(k.totalScored).toBe(4)
    expect(k.meanBrier).toBeCloseTo((0.04 + 0.49 + 0.01 + 0.04) / 4, 4)
    expect(k.meanLogLoss).toBeCloseTo((0.2 + 1.6 + 0.1 + 0.2) / 4, 4)
    // 3 out of 4 had predicted_prob_winner > 0.5 (favorite won 3 times)
    expect(k.favoriteHitRate).toBeCloseTo(0.75, 4)
  })
})
