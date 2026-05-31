// Pure: DB rows (sets + current game) → ScoreState for the in-play odds engine. No I/O.
import type { ScoreState } from './inplay-odds.js'

export interface SetRow { pair1_games: number; pair2_games: number; is_current: boolean }
export interface GameRow { game_score: string | null }

const GOLDEN_POINT_DEFAULT = true // Premier/FIP standard

export function parsePadelPoints(label: string): number {
  const s = label.trim().toUpperCase()
  if (s === 'AD' || s === 'A') return 4
  if (s === '40') return 3
  if (s === '30') return 2
  if (s === '15') return 1
  if (s === '0' || s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0 // tiebreak raw integers
}

function parsePair(score: string | null): [number, number] {
  if (!score) return [0, 0]
  const [a, b] = score.split('-').map((x) => x.trim())
  return [parsePadelPoints(a ?? '0'), parsePadelPoints(b ?? '0')]
}

export function buildScoreState(sets: SetRow[], currentGame: GameRow | null): ScoreState {
  const current = sets.find((s) => s.is_current) ?? sets[sets.length - 1]
  const setsWon: [number, number] = sets
    .filter((s) => s !== current)
    .reduce<[number, number]>(
      (acc, s) => [
        acc[0] + (s.pair1_games > s.pair2_games ? 1 : 0),
        acc[1] + (s.pair2_games > s.pair1_games ? 1 : 0),
      ],
      [0, 0],
    )
  const gamesInSet: [number, number] = current ? [current.pair1_games, current.pair2_games] : [0, 0]
  const inTiebreak = gamesInSet[0] === 6 && gamesInSet[1] === 6 && currentGame != null
  const rawPts = parsePair(currentGame?.game_score ?? null)
  return {
    setsWon,
    gamesInSet,
    currentGamePoints: inTiebreak ? [0, 0] : rawPts,
    inTiebreak,
    tiebreakPoints: inTiebreak ? rawPts : [0, 0],
    goldenPoint: GOLDEN_POINT_DEFAULT,
  }
}
