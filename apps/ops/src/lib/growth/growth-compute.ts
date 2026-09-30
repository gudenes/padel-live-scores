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
