// apps/ops/src/lib/growth/growth-compute.ts
// Pure helpers for the Growth & Adoption page. No I/O so they're unit-testable.
// Delta math is shared with the SEO dashboard (windowDelta).

export interface DayCount {
  day: string // YYYY-MM-DD (UTC)
  n: number
}

export interface DailyPoint {
  day: string
  n: number
}

/** Oldest → newest list of `days` UTC dates ending at `endDay` (inclusive). */
export function dayRange(endDay: string, days: number): string[] {
  const end = Date.parse(`${endDay}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) =>
    new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  )
}

/** Zero-fill sparse per-day counts so charts get a continuous x axis. */
export function fillDaily(rows: DayCount[], endDay: string, days: number): DailyPoint[] {
  const byDay = new Map(rows.map(r => [r.day, r.n]))
  return dayRange(endDay, days).map(day => ({ day, n: byDay.get(day) ?? 0 }))
}

/** Sum of the last `days` points vs the `days` points before them. */
export function splitWindows(
  points: DailyPoint[],
  days: number,
): { current: number; prior: number } {
  const sum = (pts: DailyPoint[]) => pts.reduce((a, p) => a + p.n, 0)
  const cur = points.slice(-days)
  const prior = points.slice(-2 * days, -days)
  return { current: sum(cur), prior: sum(prior) }
}

/** Share as an integer percent; 0 when the denominator is 0. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

// ── PostHog snapshot shaping ────────────────────────────────────────────────

export interface MetricRow { day: string; metric: string; dimension: string; value: number }

export interface RetentionCohort {
  cohort: string
  size: number
  /** retained % for weeks 0..maxWeek; null where that week hasn't elapsed yet */
  pcts: Array<number | null>
}

/**
 * Turn retention_cohort / retention rows into a matrix. `latestDay` is the
 * snapshot day; weeks that haven't fully elapsed since a cohort started are null.
 */
export function buildRetentionMatrix(rows: MetricRow[], latestDay: string, maxWeek = 8): RetentionCohort[] {
  const sizes = new Map<string, number>()
  const cells = new Map<string, number>()
  for (const r of rows) {
    if (r.metric === 'retention_cohort') sizes.set(r.dimension, r.value)
    else if (r.metric === 'retention') cells.set(r.dimension, r.value)
  }
  const latest = Date.parse(`${latestDay}T00:00:00Z`)
  return [...sizes.keys()].sort().map(cohort => {
    const size = sizes.get(cohort) ?? 0
    const weeksElapsed = Math.floor((latest - Date.parse(`${cohort}T00:00:00Z`)) / (7 * 86_400_000))
    const pcts = Array.from({ length: maxWeek + 1 }, (_, n) =>
      n >= weeksElapsed ? null : pct(cells.get(`${cohort}:${n}`) ?? 0, size),
    )
    return { cohort, size, pcts }
  })
}

export const FUNNEL_STEPS: Array<{ key: string; label: string }> = [
  { key: 'visitors', label: 'Visitors (30d)' },
  { key: 'signed_up', label: 'Signed up' },
  { key: 'bookmarked_player', label: 'Followed a player' },
  { key: 'push', label: 'Enabled web push' },
]

/** Size-weighted share of cohorts retained in week `n` (only cohorts where it has elapsed). */
export function weightedRetention(matrix: RetentionCohort[], n: number): number | null {
  let retained = 0
  let total = 0
  for (const c of matrix) {
    const p = c.pcts[n]
    if (p == null || c.size === 0) continue
    retained += (p / 100) * c.size
    total += c.size
  }
  return total > 0 ? Math.round((retained / total) * 100) : null
}
