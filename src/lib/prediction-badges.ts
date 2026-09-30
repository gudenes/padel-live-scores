/** One result per market, using confirmed payouts rather than trade/activity volume. */
export interface BadgePredictionResult {
  marketId: string
  tournamentId: string | null
  settledAt: string
  status: string
  cost: number
  paid: number
  revision: number
  payoutRevision: number
}
export function predictionBadgeCounts(results: BadgePredictionResult[]) {
  const unique = new Map<string, BadgePredictionResult>()
  for (const result of results) {
    const previous = unique.get(result.marketId)
    if (!previous || result.revision >= previous.revision) unique.set(result.marketId, result)
  }
  const settled = [...unique.values()].filter(r => r.status === 'settled' && r.revision === r.payoutRevision && r.cost > 0)
    .sort((a,b) => a.settledAt.localeCompare(b.settledAt) || a.marketId.localeCompare(b.marketId))
  let wins = 0, streak = 0, longest = 0, tournament = 0
  const tournaments = new Map<string, number>()
  for (const result of settled) {
    if (result.paid > result.cost) {
      wins++; streak++; longest = Math.max(longest, streak)
      if (result.tournamentId) {
        const n = (tournaments.get(result.tournamentId) ?? 0) + 1
        tournaments.set(result.tournamentId,n); tournament = Math.max(tournament,n)
      }
    } else streak = 0
  }
  return {prediction_count: settled.length, prediction_wins: wins, prediction_streak: longest, prediction_tournament: tournament}
}
