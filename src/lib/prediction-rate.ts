export interface PredictionRateRow {
  status: string; outcome: boolean | null; revision: number; payoutRevision: number
  yesShares: number; noShares: number
}
/** Count each settled side once, matching the result cards; never count purchases. */
export function predictionRate(rows: PredictionRateRow[]) {
  let correct = 0, settled = 0
  for (const r of rows) {
    if (r.status !== 'settled' || r.outcome === null || r.revision !== r.payoutRevision) continue
    if (r.yesShares > 0) { settled++; if (r.outcome) correct++ }
    if (r.noShares > 0) { settled++; if (!r.outcome) correct++ }
  }
  return { correct, settled, percent: settled ? Math.round(correct / settled * 100) : null }
}
