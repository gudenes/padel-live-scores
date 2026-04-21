// src/lib/padelgod-live-cards.ts
// Pure types + helpers for the Padelgod shadow-mode live UI.
// No I/O. All Supabase interaction lives in the route file.

export type PlayerLite = { name: string; country: string | null } | null

export type PointEntry = {
  set: number
  game: number
  pt: number
  server: 1 | 2 | null
  score: string
  winner: 1 | 2
  isGoldenPoint: boolean
  at: string
}

export type SetEntry = {
  setNumber: number
  pair1Games: number
  pair2Games: number
  isCurrent: boolean
}

export type CurrentGame = {
  pair1Score: string
  pair2Score: string
  isGoldenPoint: boolean
}

export type LiveCard = {
  id: string
  tournamentId: string
  tournamentName: string
  status: 'live' | 'scheduled' | 'finished'
  court: string | null
  round: string | null
  scheduledAt: string | null
  pair1: { player1: PlayerLite; player2: PlayerLite }
  pair2: { player1: PlayerLite; player2: PlayerLite }
  sets: SetEntry[]
  currentGame: CurrentGame
  servingTeam: 1 | 2 | null
  points: PointEntry[]
}

export type LiveCardsResponse = {
  observedAt: string
  matches: LiveCard[]
}

// Raw row shapes coming out of Supabase (mirror the DB columns we read)
export type ShadowSetRow = {
  match_id: string
  set_number: number
  pair1_games: number | null
  pair2_games: number | null
  updated_at: string | null
}

export type ShadowPointRow = {
  match_id: string
  set_number: number
  game_number: number
  point_number: number
  winner_pair: 1 | 2
  score_after: string | null
  server_team: 1 | 2 | null
  is_golden_point: boolean
  created_at: string
}

export type MatchRow = {
  id: string
  tournament_id: string
  status: string
  court: string | null
  round: string | null
  scheduled_at: string | null
  pair1_player1: { name: string; country: string | null } | null
  pair1_player2: { name: string; country: string | null } | null
  pair2_player1: { name: string; country: string | null } | null
  pair2_player2: { name: string; country: string | null } | null
}

// ---------------------------------------------------------------------------
// parseScoreAfter — split "40-30" into { pair1Score, pair2Score }
// Returns { "0", "0" } for null or malformed input.
// ---------------------------------------------------------------------------
export function parseScoreAfter(score: string | null): {
  pair1Score: string
  pair2Score: string
} {
  if (!score) return { pair1Score: '0', pair2Score: '0' }
  const parts = score.split('-')
  if (parts.length !== 2) return { pair1Score: '0', pair2Score: '0' }
  const [a, b] = parts
  if (!a || !b) return { pair1Score: '0', pair2Score: '0' }
  return { pair1Score: a.trim(), pair2Score: b.trim() }
}

// ---------------------------------------------------------------------------
// deriveLiveState — from a flat list of shadow points, return the currentGame
// state and the servingTeam for "right now".
// ---------------------------------------------------------------------------
export function deriveLiveState(points: ShadowPointRow[]): {
  currentGame: CurrentGame
  servingTeam: 1 | 2 | null
} {
  if (points.length === 0) {
    return {
      currentGame: { pair1Score: '0', pair2Score: '0', isGoldenPoint: false },
      servingTeam: null,
    }
  }
  // Find the latest by (set, game, pt)
  const latest = points.reduce((acc, cur) => {
    if (cur.set_number > acc.set_number) return cur
    if (cur.set_number < acc.set_number) return acc
    if (cur.game_number > acc.game_number) return cur
    if (cur.game_number < acc.game_number) return acc
    return cur.point_number > acc.point_number ? cur : acc
  }, points[0])

  const { pair1Score, pair2Score } = parseScoreAfter(latest.score_after)
  return {
    currentGame: { pair1Score, pair2Score, isGoldenPoint: latest.is_golden_point },
    servingTeam: latest.server_team,
  }
}

// ---------------------------------------------------------------------------
// markCurrentSets — normalise shadow_set rows into SetEntry[], sorted ascending
// with isCurrent=true on the highest set_number.
// ---------------------------------------------------------------------------
export function markCurrentSets(sets: ShadowSetRow[]): SetEntry[] {
  if (sets.length === 0) return []
  const sorted = [...sets].sort((a, b) => a.set_number - b.set_number)
  const maxIdx = sorted.length - 1
  return sorted.map((s, i) => ({
    setNumber: s.set_number,
    pair1Games: s.pair1_games ?? 0,
    pair2Games: s.pair2_games ?? 0,
    isCurrent: i === maxIdx,
  }))
}
