// apps/ops/src/lib/seo/seo-compute.ts
// Pure functions for KPI math. Kept separate from Supabase reads so the
// dashboard's headline tile + locale table + email digest can all
// share the same compute path.

export interface SnapshotRow {
  day: string
  locale: string
  clicks: number
  impressions: number
  avg_position: number | null
  ctr: number | null
}

export function sumWindow(rows: SnapshotRow[]): { clicks: number; impressions: number } {
  let clicks = 0
  let impressions = 0
  for (const r of rows) {
    clicks += r.clicks
    impressions += r.impressions
  }
  return { clicks, impressions }
}

export interface WindowDelta {
  deltaPct: number          // rounded to integer; positive = up
  direction: 'up' | 'down' | 'flat'
}

export function windowDelta(current: number, prior: number): WindowDelta {
  if (prior === 0 && current === 0) return { deltaPct: 0, direction: 'flat' }
  // Sentinel: when prior is 0 but current isn't, percent-change is undefined
  // (division by zero). We return deltaPct=999 as a UI-friendly cap so the
  // headline tile can render "↑ 999%" without throwing. Consumers that want
  // a cleaner story for this case can detect `deltaPct === 999` and render
  // "↑ from zero" or similar.
  if (prior === 0) return { deltaPct: 999, direction: 'up' }
  const raw = ((current - prior) / prior) * 100
  const deltaPct = Math.round(raw)
  const direction: 'up' | 'down' | 'flat' =
    Math.abs(deltaPct) <= 2 ? 'flat' : deltaPct > 0 ? 'up' : 'down'
  return { deltaPct, direction }
}

export function weightedAvgPosition(rows: SnapshotRow[]): number | null {
  let weighted = 0
  let totalImpr = 0
  for (const r of rows) {
    if (r.avg_position === null) continue
    weighted += r.avg_position * r.impressions
    totalImpr += r.impressions
  }
  if (totalImpr === 0) return null
  return Math.round((weighted / totalImpr) * 100) / 100
}
