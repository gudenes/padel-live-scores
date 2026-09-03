// Flourish bar-chart-race CSV: one row per pair, one column per clock tick.
// Values are win % (0–100). Unchanged consecutive ticks are dropped so the
// race only advances when the probability moves.

import type { Match } from './types'

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function clockUtc(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function pct(p: number): string {
  return (p * 100).toFixed(1)
}

export function flourishWinProbCsv(match: Match): string {
  const raw = match.winProbSeries
  const ticks: Array<{ atMs: number; pair1Prob: number }> = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]
    const prev = ticks[ticks.length - 1]
    if (!prev || pct(prev.pair1Prob) !== pct(cur.pair1Prob)) ticks.push(cur)
  }
  const header = ['Name', ...ticks.map((t) => clockUtc(t.atMs))].map(csvCell).join(',')
  const row1 = [csvCell(match.pair1.name), ...ticks.map((t) => pct(t.pair1Prob))].join(',')
  const row2 = [csvCell(match.pair2.name), ...ticks.map((t) => pct(1 - t.pair1Prob))].join(',')
  return `${header}\n${row1}\n${row2}\n`
}

export function flourishWinProbFilename(match: Match): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
  return `${slug(match.tournament) || 'match'}-${slug(match.pair1.name)}-vs-${slug(match.pair2.name)}-winprob.csv`
}
