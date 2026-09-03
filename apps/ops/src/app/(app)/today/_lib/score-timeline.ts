// Reconstruct the on-court score at each live-odds tick, and emit a Flourish
// Captions sheet (from, to, text) so the score can sit as a background marker.

import { clockUtc } from './win-prob-csv'

export interface PointRow {
  created_at: string
  score_after: string
  set_id: string
  game_id: string
  winner_pair: 1 | 2
}

export interface ScoredTick {
  atMs: number
  pair1Prob: number
  score: string | null
}

export function scoreTimeline(points: PointRow[]): Array<{ atMs: number; score: string }> {
  const completedSets: string[] = []
  let setId: string | null = null
  let gameId: string | null = null
  let games: [number, number] = [0, 0]
  let lastWinner: 1 | 2 = 1
  const out: Array<{ atMs: number; score: string }> = []

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
    out.push({
      atMs: +new Date(p.created_at),
      score: `${setsPart}${games[0]}-${games[1]} ${p.score_after}`.trim(),
    })
  }
  return out
}

export function attachScoreToSeries(
  series: Array<{ atMs: number; pair1Prob: number }>,
  scores: Array<{ atMs: number; score: string }>,
): ScoredTick[] {
  let i = -1
  return series.map((tick) => {
    while (i + 1 < scores.length && scores[i + 1].atMs <= tick.atMs) i++
    return { ...tick, score: i >= 0 ? scores[i].score : null }
  })
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
