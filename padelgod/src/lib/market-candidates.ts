// Row → Candidate mapping for the market generator.

import type { Candidate } from './market-gates.js'

export interface MatchRow {
  id: string
  tournament_id: string | null
  category: string | null
  round: string | null
  /** Normalised round — 'SF', 'F', 'QF', 'R32'. `round` itself is free-text
   *  from upstream scrapers ('Semifinals', 'SemiFinals', 'Finals', 'Final',
   *  'Quarter', 'Quarterfinals'), so gates must never compare against it. */
  round_canonical: string | null
  scheduled_at: string | null
  /** PostgREST returns numeric columns as strings. */
  pred_pair1_prob: string | number | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
}

function bestRanking(row: MatchRow, ranks: Map<string, number>): number | null {
  const ids = [
    row.pair1_player1_id, row.pair1_player2_id,
    row.pair2_player1_id, row.pair2_player2_id,
  ]
  let best: number | null = null
  for (const id of ids) {
    if (!id) continue
    const r = ranks.get(id)
    if (typeof r !== 'number') continue
    if (best === null || r < best) best = r
  }
  return best
}

export function matchRowToCandidate(
  row: MatchRow,
  ranks: Map<string, number>,
  templateKey: string,
  subsidyGuacas: number,
): Candidate {
  const raw = row.pred_pair1_prob
  const prob = raw === null || raw === undefined ? null : Number(raw)

  return {
    key: `${templateKey}:${row.id}`,
    matchId: row.id,
    tournamentId: row.tournament_id,
    category: row.category === 'women' ? 'women' : row.category === 'men' ? 'men' : null,
    round: row.round_canonical,
    bestRanking: bestRanking(row, ranks),
    modelProb: prob !== null && Number.isFinite(prob) ? prob : null,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    subsidyGuacas,
  }
}
