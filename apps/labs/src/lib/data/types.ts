// apps/labs/src/lib/data/types.ts
// Shared row types returned by data/* skills. Kept minimal — only fields the
// chat engine cites or surfaces. If a skill needs more, add to that skill's
// own return type.

export type PlayerRow = {
  id: string
  name: string
  country: string | null
  category: 'men' | 'women' | null
  ranking: number | null
}

export type MatchSummary = {
  id: string
  played_at: string | null            // ISO date
  tournament_id: string | null
  tournament_name: string | null
  round: string | null
  status: string
  pair1: { player1_name: string | null; player2_name: string | null }
  pair2: { player1_name: string | null; player2_name: string | null }
  winner_pair: number | null          // 1 or 2
  set_scores: string[]                // e.g. ['6-3', '4-6', '7-6']
}

export type Citation = {
  match_id: string
  played_at: string | null
  tournament_name: string | null
  score: string                        // joined set scores
  pair1: string                        // "Tapia / Coello"
  pair2: string
}
