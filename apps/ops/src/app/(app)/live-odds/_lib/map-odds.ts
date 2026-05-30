// apps/ops/src/app/(app)/live-odds/_lib/map-odds.ts
import type { Confidence, MatchStatus } from './types'

export function mapConfidence(c: string): Confidence {
  if (c === 'full') return 'full'
  if (c === 'med' || c === 'pre-match') return 'med'
  return 'low' // 'thin'
}

export function mapStatus(s: string): MatchStatus {
  if (s === 'live' || s === 'on_court') return 'Live'
  if (s === 'break') return 'Break'
  return 'Scheduled'
}

export interface SnapshotRow { match_id: string; pair1_win_prob: number; computed_at: string }

/** Latest pair1 win% minus the snapshot nearest to 15m ago, in percentage points. */
export function movementFromSnapshots(rows: SnapshotRow[], matchId: string, nowMs = Date.now()): number {
  const mine = rows
    .filter((r) => r.match_id === matchId)
    .sort((a, b) => +new Date(a.computed_at) - +new Date(b.computed_at))
  if (mine.length === 0) return 0
  const latest = mine[mine.length - 1]
  const target = nowMs - 15 * 60000
  const old = mine.find((r) => +new Date(r.computed_at) <= target)
  if (!old) return 0
  return Math.round((latest.pair1_win_prob - old.pair1_win_prob) * 100)
}
