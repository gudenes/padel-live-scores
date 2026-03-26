// src/types/match.ts

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'cancelled' | 'retired' | 'walkover' | 'suspended'
export type Coverage = 'full' | 'partial' | 'tracking' | null

export interface Player {
  id: string
  external_id: string
  name: string
  country: string | null
  avatar_url: string | null
  ranking?: number | null
  win_rate?: number | null
  total_matches?: number | null
  side?: string | null
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
  serving_player_id?: string | null
  pair1_player1: Player | null
  pair1_player2: Player | null
  pair2_player1: Player | null
  pair2_player2: Player | null
  sets?: Set[]
  viewer_count?: number
}

// ── Warmup detection ──────────────────────────────────────────
// A match is "warming up" when the API reports it as live
// but no real points have been scored yet.
// Used to hide matches from the live feed until play starts.
export function isWarmingUp(match: Match): boolean {
  if (match.status !== 'live') return false
  const sets = match.sets ?? []
  if (sets.length === 0) return true
  const allGames = sets.flatMap((s) => s.games ?? [])
  if (allGames.length === 0) return true
  const allPoints = allGames.flatMap((g) => g.points ?? [])
  if (allPoints.length === 0) return true
  const realPoints = allPoints.filter((p) => p !== '0:0')
  return realPoints.length === 0
}



// ── Current score state for a match ──────────────────────────
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
    const parsed = parseSetScore(s.set_score)
    return parsed ? parsed.p1 > parsed.p2 : false
  }).length

  const pair2Sets = completedSets.filter((s) => {
    const parsed = parseSetScore(s.set_score)
    return parsed ? parsed.p2 > parsed.p1 : false
  }).length

  const currentGame = currentSet?.games?.find((g) => g.is_current) ?? null

  return { pair1Sets, pair2Sets, currentSet, currentGame }
}

// ── Parse set score ───────────────────────────────────────────
// Handles multiple formats:
// "7-61" (from /live endpoint) → {p1: 7, p2: 6, tb: 1}
// "6(1)" style handled at match level via score array
export function parseSetScore(score: string | null): { p1: number; p2: number; tb: number | null } | null {
  if (!score) return null
  const parts = score.split('-')
  if (parts.length !== 2) return null
  const p1str = parts[0]
  const p2str = parts[1]

  // Format: "6(1)-7" or "7-6(1)" — tiebreak in brackets on either side
  const p1BracketMatch = p1str.match(/^(\d+)\((\d+)\)$/)
  if (p1BracketMatch) {
    return { p1: parseInt(p1BracketMatch[1]), p2: parseInt(p2str), tb: parseInt(p1BracketMatch[2]) }
  }
  const p2BracketMatch = p2str.match(/^(\d+)\((\d+)\)$/)
  if (p2BracketMatch) {
    return { p1: parseInt(p1str), p2: parseInt(p2BracketMatch[1]), tb: parseInt(p2BracketMatch[2]) }
  }

  const p1 = parseInt(p1str)
  const p2 = parseInt(p2str)

  // Format: "65-7" — tiebreak concatenated to p1 (e.g. p1 lost 6-7 with tb=5)
  if (p1str.length >= 2 && p2 <= 7 && p1str.length > String(p2 - 1 > 0 ? p2 - 1 : 0).length) {
    const realP1 = parseInt(p1str[0])
    const tb = parseInt(p1str.slice(1))
    if (realP1 >= 6 && realP1 <= 7 && tb >= 0) {
      return { p1: realP1, p2, tb }
    }
  }

  // Format: "7-61" — tiebreak concatenated to p2 (e.g. p2 lost 6-7 with tb=1)
  if (p2str.length >= 2 && p1 <= 7) {
    const realP2 = parseInt(p2str[0])
    const tb = parseInt(p2str.slice(1))
    if (realP2 >= 6 && realP2 <= 7 && tb >= 0) {
      return { p1, p2: realP2, tb }
    }
  }

  return { p1, p2, tb: null }
}

function toShortName(name: string): string {
  const parts = name.trim().split(' ')
  if (parts.length <= 1) return name
  return parts[0][0] + '. ' + parts.slice(1).join(' ')
}

// Last name only for compact pair display
export function pairName(p1: Player | null, p2: Player | null): string {
  if (!p1 && !p2) return 'TBD'
  if (!p2) return toShortName(p1?.name ?? 'TBD')
  return `${toShortName(p1?.name ?? '')} / ${toShortName(p2?.name ?? '')}`
}

// Detects star point — 40:40 that follows at least one advantage point
export function isStarPoint(points: string[]): boolean {
  if (!points.length) return false
  const last = points[points.length - 1]
  if (last !== '40:40') return false
  const hadAdvantage = points.slice(0, -1).some(
    (p) => p === 'A:40' || p === '40:A'
  )
  return hadAdvantage
}

// Compute last N points won across all games in current set
export function getLastNPoints(
  currentSet: Set | null,
  n: number = 10
): { winner: 1 | 2 }[] {
  if (!currentSet) return []

  const allPoints: { winner: 1 | 2 }[] = []
  const games = [...(currentSet.games ?? [])].sort((a, b) => a.game_number - b.game_number)

  for (const game of games) {
    const pts = game.points ?? []
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const curr = pts[i]
      if (prev === curr) continue

      const prevParts = prev.split(':')
      const currParts = curr.split(':')

      const p1Prev = prevParts[0] === 'A' ? 50 : prevParts[0] === '40' ? 40 : parseInt(prevParts[0])
      const p2Prev = prevParts[1] === 'A' ? 50 : prevParts[1] === '40' ? 40 : parseInt(prevParts[1])
      const p1Curr = currParts[0] === 'A' ? 50 : currParts[0] === '40' ? 40 : parseInt(currParts[0])
      const p2Curr = currParts[1] === 'A' ? 50 : currParts[1] === '40' ? 40 : parseInt(currParts[1])

      if (p1Curr > p1Prev) allPoints.push({ winner: 1 })
      else if (p2Curr > p2Prev) allPoints.push({ winner: 2 })
    }

    if (pts.length > 0 && game.game_score && game.game_score !== '0-0' && !game.is_current) {
      const lastPt = pts[pts.length - 1]
      const parts = lastPt.split(':')
      const p1 = parts[0] === 'A' ? 50 : parseInt(parts[0])
      const p2 = parts[1] === 'A' ? 50 : parseInt(parts[1])
      if (p1 >= 40 && p2 < 40) allPoints.push({ winner: 1 })
      else if (p2 >= 40 && p1 < 40) allPoints.push({ winner: 2 })
      else if (parts[0] === 'A') allPoints.push({ winner: 1 })
      else if (parts[1] === 'A') allPoints.push({ winner: 2 })
    }
  }

  return allPoints.slice(-n)
}

// Country code → flag emoji
export function countryFlag(country: string | null): string {
  if (!country) return ''
  const flags: Record<string, string> = {
    ES: '🇪🇸', AR: '🇦🇷', BR: '🇧🇷', PT: '🇵🇹',
    FR: '🇫🇷', IT: '🇮🇹', BE: '🇧🇪', NL: '🇳🇱',
    DE: '🇩🇪', GB: '🇬🇧', DK: '🇩🇰', SE: '🇸🇪',
    UY: '🇺🇾', PY: '🇵🇾', CL: '🇨🇱', MX: '🇲🇽',
    US: '🇺🇸', AU: '🇦🇺', QA: '🇶🇦',
  }
  return flags[country.toUpperCase()] ?? ''
}
