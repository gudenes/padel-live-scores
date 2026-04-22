// Pure point/game utilities: extractGamePoints, inferWinnerFromPoints, computeGameWinner, pairMatchesIds, simulatePoll.
import { Game } from '@/types/match'

// ── Point extraction from a game's points array ──────────────────────────────
export function extractGamePoints(game: Game): { scorer: 1 | 2; score: string; isSP: boolean }[] {
  const pts = (game.points ?? []).filter(p => p !== '0:0')
  const result: { scorer: 1 | 2; score: string; isSP: boolean }[] = []
  const val = (s: string) => s === 'A' ? 50 : s === '40' ? 40 : s === '30' ? 30 : s === '15' ? 15 : 0
  const fmt = (s: string) => s === 'A' ? 'Adv' : s

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]
    const [p1s, p2s] = pt.split(':')
    const p1v = val(p1s), p2v = val(p2s)
    let scorer: 1 | 2 | null = null

    if (i === 0) {
      scorer = p1v > 0 ? 1 : p2v > 0 ? 2 : null
    } else {
      const [p1sPrev, p2sPrev] = pts[i - 1].split(':')
      if (p1v > val(p1sPrev)) scorer = 1
      else if (p2v > val(p2sPrev)) scorer = 2
    }
    if (!scorer) continue
    const isSP = pt === '40:40' && pts.slice(0, i).some(p => p === 'A:40' || p === '40:A')
    result.push({ scorer, score: `${fmt(p1s)} – ${fmt(p2s)}`, isSP })
  }
  return result
}

// ── Infer game winner from points array (fallback) ────────────────────────────
export function inferWinnerFromPoints(game: any): 1 | 2 | null {
  const pts = (game?.points ?? []).filter((p: string) => p !== '0:0')
  if (pts.length === 0) return null
  const last = pts[pts.length - 1]
  const parts = last.split(':')
  if (parts.length !== 2) return null
  const [raw1, raw2] = parts
  const STD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4 }
  const v1 = STD[raw1], v2 = STD[raw2]
  if (v1 !== undefined && v2 !== undefined) {
    return v1 !== v2 ? (v1 > v2 ? 1 : 2) : null
  }
  const n1 = parseInt(raw1, 10), n2 = parseInt(raw2, 10)
  if (!isNaN(n1) && !isNaN(n2) && n1 !== n2) return n1 > n2 ? 1 : 2
  return null
}

// ── Compute game winner ───────────────────────────────────────────────────────
// Points-first: the points array is ground truth for what happened in THIS game.
// game_score is a cumulative "before-this-game" counter whose differential
// actually yields the PREVIOUS game's winner (off-by-one). Points are always
// preferred; game_score is a fallback for games without point data.
export function computeGameWinner(games: any[], idx: number): 1 | 2 | null {
  const game = games[idx]

  // Primary: infer from the points array
  const pointsWinner = inferWinnerFromPoints(game)
  if (pointsWinner) return pointsWinner

  // Fallback: game_score differential (imperfect — see note above)
  const score = game?.game_score
  if (score && score !== '0-0') {
    const [p1, p2] = score.split('-').map(Number)
    if (idx === 0) return p1 > p2 ? 1 : 2
    const prev = games[idx - 1]?.game_score
    if (!prev || prev === '0-0') return p1 > p2 ? 1 : 2
    const [pp1, pp2] = prev.split('-').map(Number)
    if (p1 > pp1) return 1
    if (p2 > pp2) return 2
  }

  return null
}

// ── Pair match checker for H2H filtering ─────────────────────────────────────
export function pairMatchesIds(p1Id: string | null, p2Id: string | null, targetIds: string[]): boolean {
  return targetIds.includes(p1Id ?? '') && targetIds.includes(p2Id ?? '')
}

// ── Simulated community poll (deterministic from match ID) ───────────────────
export function simulatePoll(matchId: string): { pair1Pct: number; totalVotes: number; straightPct: number } {
  let hash = 0
  for (let i = 0; i < matchId.length; i++) {
    hash = ((hash << 5) - hash) + matchId.charCodeAt(i)
    hash |= 0
  }
  const pair1Pct = 45 + (Math.abs(hash) % 25) // 45-69%
  const totalVotes = 20 + (Math.abs(hash >> 8) % 80) // 20-99
  const straightPct = 30 + (Math.abs(hash >> 16) % 35) // 30-64%
  return { pair1Pct, totalVotes, straightPct }
}
