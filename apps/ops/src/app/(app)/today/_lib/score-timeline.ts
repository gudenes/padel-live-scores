// Reconstruct the on-court score at each live-odds tick, and emit a Flourish
// Captions sheet (from, to, text) so the score can sit as a background marker.

import { clockUtc } from './win-prob-csv'

export interface PointRow {
  created_at: string
  score_after: string
  set_id: string
  game_id: string
  winner_pair: 1 | 2
  server_player_id?: string | null
  is_break_point?: boolean
  is_set_point?: boolean
  is_match_point?: boolean
  is_golden_point?: boolean
}

export interface PairIds {
  pair1: Set<string>
  pair2: Set<string>
}

export interface PointContext {
  atMs: number
  score: string
  serverPair: 1 | 2 | null
  isBreakPoint: boolean
  isSetPoint: boolean
  isMatchPoint: boolean
  isGoldenPoint: boolean
  setsCompleted: number
}

export interface ScoredTick {
  atMs: number
  pair1Prob: number
  score: string | null
  serverPair?: 1 | 2 | null
  isBreakPoint?: boolean
  isSetPoint?: boolean
  isMatchPoint?: boolean
  isGoldenPoint?: boolean
  setsCompleted?: number
}

const GAME_POINTS = new Set(['0', '15', '30', '40', 'A', 'AD'])

function splitScore(scoreAfter: string): [string, string] | null {
  const parts = String(scoreAfter).trim().toUpperCase().split('-')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return [parts[0], parts[1]]
}

function isStandardGame(a: string, b: string): boolean {
  return GAME_POINTS.has(a) && GAME_POINTS.has(b)
}

/** Who is one point from winning this standard game? */
export function gamePointPair(scoreAfter: string): 1 | 2 | 'both' | null {
  const parts = splitScore(scoreAfter)
  if (!parts || !isStandardGame(parts[0], parts[1])) return null
  const [a, b] = parts
  if (a === '40' && b === '40') return 'both'
  const p1 = (a === '40' && (b === '0' || b === '15' || b === '30')) || a === 'A' || a === 'AD'
  const p2 = (b === '40' && (a === '0' || a === '15' || a === '30')) || b === 'A' || b === 'AD'
  if (p1 && p2) return 'both'
  if (p1) return 1
  if (p2) return 2
  return null
}

export function isBreakPoint(scoreAfter: string, serverPair: 1 | 2 | null): boolean {
  if (serverPair !== 1 && serverPair !== 2) return false
  const gp = gamePointPair(scoreAfter)
  if (gp === null) return false
  if (gp === 'both') return true
  return gp !== serverPair
}

function serverPairOf(serverId: string | null | undefined, ids?: PairIds): 1 | 2 | null {
  if (!serverId || !ids) return null
  if (ids.pair1.has(serverId)) return 1
  if (ids.pair2.has(serverId)) return 2
  return null
}

function wouldWinSet(games: [number, number], pair: 1 | 2): boolean {
  const next: [number, number] = [games[0], games[1]]
  next[pair - 1] += 1
  const a = next[0]
  const b = next[1]
  const lead = pair === 1 ? a - b : b - a
  const got = pair === 1 ? a : b
  return got >= 6 && lead >= 2
}

function wouldWinMatch(completedSets: string[], pair: 1 | 2): boolean {
  let p1 = 0
  let p2 = 0
  for (const s of completedSets) {
    const [a, b] = s.split('-').map(Number)
    if (a > b) p1++
    else if (b > a) p2++
  }
  return (pair === 1 ? p1 : p2) + 1 >= 2
}

export function scoreTimeline(points: PointRow[], ids?: PairIds): PointContext[] {
  const completedSets: string[] = []
  let setId: string | null = null
  let gameId: string | null = null
  let games: [number, number] = [0, 0]
  let lastWinner: 1 | 2 = 1
  const out: PointContext[] = []

  for (const p of points) {
    if (gameId !== null && p.game_id !== gameId) {
      games[lastWinner - 1] += 1
    }
    if (setId !== null && p.set_id !== setId) {
      completedSets.push(`${games[0]}-${games[1]}`)
      games = [0, 0]
    }
    setId = p.set_id
    gameId = p.game_id
    lastWinner = p.winner_pair === 2 ? 2 : 1
    const setsPart = completedSets.length ? `${completedSets.join(' ')} ` : ''
    const serverPair = serverPairOf(p.server_player_id, ids)
    const gp = gamePointPair(p.score_after)
    const pressurePairs: Array<1 | 2> =
      gp === 'both' ? [1, 2] : gp === 1 || gp === 2 ? [gp] : []
    const inferredBp = isBreakPoint(p.score_after, serverPair)
    const inferredSp = pressurePairs.some((pair) => wouldWinSet(games, pair))
    const inferredMp = pressurePairs.some((pair) => wouldWinSet(games, pair) && wouldWinMatch(completedSets, pair))
    out.push({
      atMs: +new Date(p.created_at),
      score: `${setsPart}${games[0]}-${games[1]} ${p.score_after}`.trim(),
      serverPair,
      isBreakPoint: Boolean(p.is_break_point) || inferredBp,
      isSetPoint: Boolean(p.is_set_point) || inferredSp,
      isMatchPoint: Boolean(p.is_match_point) || inferredMp,
      isGoldenPoint: Boolean(p.is_golden_point) || gamePointPair(p.score_after) === 'both',
      setsCompleted: completedSets.length,
    })
  }
  return out
}

export function attachScoreToSeries(
  series: Array<{ atMs: number; pair1Prob: number }>,
  scores: Array<PointContext | { atMs: number; score: string }>,
): ScoredTick[] {
  let i = -1
  return series.map((tick) => {
    while (i + 1 < scores.length && scores[i + 1].atMs <= tick.atMs) i++
    const ctx = i >= 0 ? scores[i] : null
    if (!ctx) return { ...tick, score: null }
    const full = ctx as PointContext
    return {
      ...tick,
      score: ctx.score,
      serverPair: full.serverPair ?? null,
      isBreakPoint: Boolean(full.isBreakPoint),
      isSetPoint: Boolean(full.isSetPoint),
      isMatchPoint: Boolean(full.isMatchPoint),
      isGoldenPoint: Boolean(full.isGoldenPoint),
      setsCompleted: full.setsCompleted ?? 0,
    }
  })
}

/**
 * Snapshots land every ~20s, so a single set-point rally would paint a
 * necklace of SP dots. Keep one marker at the *onset* of each BP/SP/MP run.
 * MP wins over SP, SP over BP — same priority as the chart.
 */
export function pressureOnsets(
  series: Array<{ isBreakPoint?: boolean; isSetPoint?: boolean; isMatchPoint?: boolean }>,
): Array<{ bp: boolean; sp: boolean; mp: boolean }> {
  let prevBp = false
  let prevSp = false
  let prevMp = false
  return series.map((s) => {
    const isMp = Boolean(s.isMatchPoint)
    const isSp = Boolean(s.isSetPoint) && !isMp
    const isBp = Boolean(s.isBreakPoint) && !isSp && !isMp
    const out = { bp: isBp && !prevBp, sp: isSp && !prevSp, mp: isMp && !prevMp }
    prevBp = isBp
    prevSp = isSp
    prevMp = isMp
    return out
  })
}

/** Last tick of each completed set — vertical bars on the win-prob chart. */
export function setBoundaryTimes(ticks: Array<{ atMs: number; setsCompleted?: number }>): number[] {
  const out: number[] = []
  for (let i = 1; i < ticks.length; i++) {
    const prev = ticks[i - 1].setsCompleted ?? 0
    const cur = ticks[i].setsCompleted ?? 0
    if (cur > prev) out.push(ticks[i - 1].atMs)
  }
  return out
}

export function flourishCaptionsCsv(ticks: ScoredTick[]): string {
  const lines = ['from,to,text']
  let run: { from: string; to: string; text: string } | null = null
  const flush = () => {
    if (run) lines.push(`${run.from},${run.to},${run.text}`)
  }
  for (const t of ticks) {
    if (!t.score) continue
    const stamp = clockUtc(t.atMs)
    if (run && run.text === t.score) {
      run.to = stamp
    } else {
      flush()
      run = { from: stamp, to: stamp, text: t.score }
    }
  }
  flush()
  return `${lines.join('\n')}\n`
}
