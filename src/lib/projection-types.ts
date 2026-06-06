// Shape of public.tournament_projections rows (read-only on the public app).
// Written by padelgod's tournament-projection-snapshot (see Plan A).
export type ProjRound = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'

export interface ProjectionOpponentJson {
  pair_key: string
  player_ids: string[]
  names: string[]
  reach_prob: number
  win_prob: number
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
  computed_at: string
}
