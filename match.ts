// src/types/match.ts
// TypeScript types matching the Supabase schema

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'cancelled'
export type Coverage = 'full' | 'partial' | 'tracking' | null

export interface Player {
  id: string
  external_id: string
  name: string
  country: string | null
  avatar_url: string | null
}

export interface Game {
  id: string
  match_id: string
  set_id: string
  game_number: number
  game_score: string | null
  points: string[]
  is_current: boolean
  winner_pair: number | null
}

export interface Set {
  id: string
  match_id: string
  set_number: number
  set_score: string | null
  pair1_games: number
  pair2_games: number
  is_current: boolean
  games?: Game[]
}

export interface Match {
  id: string
  external_id: string
  status: MatchStatus
  coverage: Coverage
  pusher_channel: string | null
  round: string | null
  court: string | null
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  winner_pair: number | null
  // Joined player data
  pair1_player1: Player | null
  pair1_player2: Player | null
  pair2_player1: Player | null
  pair2_player2: Player | null
  // Joined sets
  sets?: Set[]
  // Presence count
  viewer_count?: number
}

// Helper: get current score summary for a match
export function getCurrentScore(match: Match): {
  pair1Sets: number
  pair2Sets: number
  currentSet: Set | null
  currentGame: Game | null
} {
  const sets = match.sets ?? []
  const completedSets = sets.filter((s) => s.set_score !== null)
  const currentSet = sets.find((s) => s.is_current) ?? null

  const pair1Sets = completedSets.filter((s) => {
    if (!s.set_score) return false
    const [a, b] = s.set_score.split('-').map(Number)
    return a > b
  }).length

  const pair2Sets = completedSets.filter((s) => {
    if (!s.set_score) return false
    const [a, b] = s.set_score.split('-').map(Number)
    return b > a
  }).length

  const currentGame =
    currentSet?.games?.find((g) => g.is_current) ?? null

  return { pair1Sets, pair2Sets, currentSet, currentGame }
}

// Helper: format pair name
export function pairName(p1: Player | null, p2: Player | null): string {
  if (!p1 && !p2) return 'TBD'
  if (!p2) return p1?.name ?? 'TBD'
  // Last names only for compact display
  const lastName = (name: string) => name.split(' ').slice(-1)[0]
  return `${lastName(p1?.name ?? '')} / ${lastName(p2?.name ?? '')}`
}
