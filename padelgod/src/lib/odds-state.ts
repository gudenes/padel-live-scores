import type { OddsInput, ScoreState } from './odds/types.js'

export interface MatchRows {
  rankings: [number | null, number | null, number | null, number | null]
  status: string // 'scheduled' | 'live' | 'on_court' | 'finished' | ...
  sets: Array<{ pair1_games: number; pair2_games: number; is_current: boolean }>
  currentGame: { game_score: string | null; server_player_id: string | null } | null
  hasRecentPoints: boolean // a match_points row inserted recently
}

const GOLDEN_POINT_DEFAULT = true // Premier/FIP standard

export function parsePadelPoints(label: string): number {
  const s = label.trim().toUpperCase()
  if (s === 'AD' || s === 'A') return 4
  if (s === '40') return 3
  if (s === '30') return 2
  if (s === '15') return 1
  if (s === '0' || s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0 // tiebreak raw numbers fall through here
}

function parsePair(score: string | null): [number, number] {
  if (!score) return [0, 0]
  const [a, b] = score.split('-').map((x) => x.trim())
  return [parsePadelPoints(a ?? '0'), parsePadelPoints(b ?? '0')]
}

const LIVE_STATUSES = new Set(['live', 'on_court', 'break'])

export function buildOddsInput(rows: MatchRows): OddsInput {
  const isLive = LIVE_STATUSES.has(rows.status)
  if (!isLive) {
    return { rankings: rows.rankings, score: null, pointByPoint: false }
  }
  const current = rows.sets.find((s) => s.is_current) ?? rows.sets[rows.sets.length - 1]
  const setsWon: [number, number] = rows.sets
    .filter((s) => s !== current)
    .reduce<[number, number]>(
      (acc, s) => [acc[0] + (s.pair1_games > s.pair2_games ? 1 : 0), acc[1] + (s.pair2_games > s.pair1_games ? 1 : 0)],
      [0, 0],
    )
  const gamesInSet: [number, number] = current ? [current.pair1_games, current.pair2_games] : [0, 0]
  const inTiebreak = gamesInSet[0] === 6 && gamesInSet[1] === 6 && rows.currentGame != null
  const rawPts = parsePair(rows.currentGame?.game_score ?? null)

  const score: ScoreState = {
    setsWon,
    gamesInSet,
    currentGamePoints: inTiebreak ? [0, 0] : rawPts,
    inTiebreak,
    tiebreakPoints: inTiebreak ? rawPts : [0, 0],
    goldenPoint: GOLDEN_POINT_DEFAULT,
  }
  return { rankings: rows.rankings, score, pointByPoint: rows.hasRecentPoints }
}
