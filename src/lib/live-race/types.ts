export type Gender = 'men' | 'women'
export interface RacePlayer {
  id: string; name: string; display_name?: string | null; country: string | null; avatar_url: string | null
  profile_url?: string | null; category: Gender; race_ranking: number; race_points: number
  officialRank: number; officialPoints: number; liveGain: number; pending: boolean
}
export interface Tournament {
  id: string; name: string; level: string; starts_at: string; ends_at: string; fip_id?: string | null
}
export interface MatchResult {
  id: string; tournament_id: string; category: Gender; round: string | null; round_canonical: string | null
  status: string; winner_pair: number | null; finished_at: string | null; scheduled_at: string | null
  pair1_player1_id: string | null; pair1_player2_id: string | null; pair2_player1_id: string | null; pair2_player2_id: string | null
  pair1_seed: number | null; pair2_seed: number | null
}
export interface TournamentResult { key: string; name: string; date: string; points: number }
export interface Breakdown { date: string; results: TournamentResult[] }
export interface Award { playerId: string; tournament: Tournament; points: number; uncertain: boolean }
export interface RaceSnapshot {
  version: 1; gender: Gender; baselineDate: string; checkedAt: string; computedAt: string
  players: RacePlayer[]; totalPlayers: number; appliedPlayers: number; pendingPlayers: number
  resultCount: number; status: 'live' | 'official' | 'partial' | 'stale'; error?: string
  reconciliation: { previousDate: string | null; changedPlayers: number; at: string } | null
}
