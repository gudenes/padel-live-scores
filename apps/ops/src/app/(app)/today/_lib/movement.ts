// apps/ops/src/app/(app)/today/_lib/movement.ts
// Pure helpers for the scoreboard. No I/O. "now" is injected for testability.
import type { Confidence } from './types'

export function capHistory(values: number[], cap = 30): number[] {
  return values.length <= cap ? values : values.slice(values.length - cap)
}

export interface ProbPoint { prob: number; atMs: number }

// Signed delta in prob over ~15m: latest minus the value at-or-before 15m ago
// (or the oldest available if none is that old). 0 when <2 points.
export function movement15m(series: ProbPoint[], nowMs: number): number {
  if (series.length < 2) return 0
  const sorted = [...series].sort((a, b) => a.atMs - b.atMs)
  const latest = sorted[sorted.length - 1]
  const cutoff = nowMs - 15 * 60_000
  let baseline = sorted[0]
  for (const p of sorted) {
    if (p.atMs <= cutoff) baseline = p
    else break
  }
  return latest.prob - baseline.prob
}

export function coverageToConfidence(coverage: string | null): Confidence {
  if (coverage === 'live-pbp') return 'full'
  if (coverage === 'live-coarse') return 'low'
  return 'med'
}

export function biggestSwing(
  rows: Array<{ movement15m: number; label: string }>,
): { pct: number; label: string } {
  if (rows.length === 0) return { pct: 0, label: '—' }
  const top = rows.reduce((m, r) => (Math.abs(r.movement15m) > Math.abs(m.movement15m) ? r : m))
  return { pct: Math.round(top.movement15m * 100), label: top.label }
}
