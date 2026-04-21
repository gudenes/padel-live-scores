// src/lib/padelgod-live-cards.ts
// Pure types + helpers for the Padelgod shadow-mode live UI.
// No I/O. All Supabase interaction lives in the route file.

// Shared polling interval for the ops tab + hidden preview page clients.
export const LIVE_CARDS_POLL_MS = 5_000

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

// ---------------------------------------------------------------------------
// buildLiveCard — compose a LiveCard from a match row + its shadow sets + its
// shadow points. Points ordered oldest-first, capped at 50.
// ---------------------------------------------------------------------------

const MAX_POINTS = 50

// If a match has a shadow point captured within this window, padelgod
// considers it live — even if the canonical matches.status column hasn't
// caught up (common for qualifiers where padelapi.org has no data).
export const LIVE_ACTIVITY_WINDOW_MS = 5 * 60 * 1000

function normaliseStatus(raw: string): 'live' | 'scheduled' | 'finished' {
  if (raw === 'live') return 'live'
  if (raw === 'ended' || raw === 'finished' || raw === 'retired' || raw === 'walkover') return 'finished'
  return 'scheduled'
}

function comparePoints(a: ShadowPointRow, b: ShadowPointRow): number {
  if (a.set_number !== b.set_number) return a.set_number - b.set_number
  if (a.game_number !== b.game_number) return a.game_number - b.game_number
  return a.point_number - b.point_number
}

/**
 * Returns true if the most recent point in `points` was captured within
 * `windowMs` of `nowMs`. Used to decide whether padelgod should surface a
 * match as "live" regardless of the canonical matches.status value.
 */
export function isRecentlyActive(
  points: ShadowPointRow[],
  nowMs: number,
  windowMs: number = LIVE_ACTIVITY_WINDOW_MS,
): boolean {
  if (points.length === 0) return false
  const latestMs = points.reduce((max, p) => {
    const t = Date.parse(p.created_at)
    return Number.isFinite(t) && t > max ? t : max
  }, 0)
  if (latestMs === 0) return false
  return nowMs - latestMs <= windowMs
}

export function buildLiveCard(
  match: MatchRow,
  tournamentName: string,
  sets: ShadowSetRow[],
  points: ShadowPointRow[],
  nowMs: number = Date.now(),
): LiveCard {
  const canonicalStatus = normaliseStatus(match.status)
  const sortedPoints = [...points].sort(comparePoints)
  const cappedPoints = sortedPoints.slice(-MAX_POINTS)

  // Override to 'live' when padelgod is actively capturing points — unless
  // the canonical pipeline has already declared the match finished.
  const status: 'live' | 'scheduled' | 'finished' =
    canonicalStatus !== 'finished' && isRecentlyActive(sortedPoints, nowMs)
      ? 'live'
      : canonicalStatus

  const live = status === 'live'
    ? deriveLiveState(sortedPoints)
    : {
        currentGame: { pair1Score: '0', pair2Score: '0', isGoldenPoint: false } as CurrentGame,
        servingTeam: null as 1 | 2 | null,
      }

  return {
    id: match.id,
    tournamentId: match.tournament_id,
    tournamentName,
    status,
    court: match.court,
    round: match.round,
    scheduledAt: match.scheduled_at,
    pair1: {
      player1: match.pair1_player1,
      player2: match.pair1_player2,
    },
    pair2: {
      player1: match.pair2_player1,
      player2: match.pair2_player2,
    },
    sets: markCurrentSets(sets),
    currentGame: live.currentGame,
    servingTeam: live.servingTeam,
    points: cappedPoints.map(p => ({
      set: p.set_number,
      game: p.game_number,
      pt: p.point_number,
      server: p.server_team,
      score: p.score_after ?? '0-0',
      winner: p.winner_pair,
      isGoldenPoint: p.is_golden_point,
      at: p.created_at,
    })),
  }
}
