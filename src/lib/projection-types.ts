// Shape of public.tournament_projections rows (read-only on the public app).
// Written by padelgod's tournament-projection-snapshot (see Plan A).
export type ProjRound = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'

export interface ProjectionOpponentJson {
  pair_key: string
  player_ids: string[]
  names: string[]
  reach_prob: number
  win_prob: number
  /** Set only for already-played rounds: the actual result. Null for projected. */
  result?: 'won' | 'lost' | null
}

export interface ProjectionRoundJson {
  round: ProjRound
  reach_prob: number
  expected_opponent_pair_key: string | null
  opponents: ProjectionOpponentJson[]
}

export interface ProjectionRow {
  tournament_id: string
  category: 'men' | 'women'
  pair_key: string
  pair_player_ids: string[]
  tournament_level: string | null
  status: 'active' | 'eliminated' | 'champion'
  eliminated_round: string | null
  champion_prob: number
  finalist_prob: number
  semifinal_prob: number
  rounds: ProjectionRoundJson[]
  /** Frozen-once projected finish round (the model's pre-tournament call).
   *  Null until the worker first captures it. Used to grade the call after the
   *  fact via predictionVerdict(). */
  predicted_finish_round?: ProjRound | null
  computed_at: string
}
