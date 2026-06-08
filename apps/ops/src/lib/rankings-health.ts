// apps/ops/src/lib/rankings-health.ts
// Pure health verdict for the FIP rankings integration (padelgod player-rankings
// worker). Derives status from player_ranking_snapshots freshness — did the
// current ISO week get captured? No DB / no I/O here; the route supplies inputs.
//
// isoYearWeek + weekToDate use the SAME ISO-week algorithm as
// padelgod/src/workers/player-rankings.ts (lines ~97-125). If that worker's
// core week computation changes, update these copies. Return shapes are
// intentionally narrowed here.

export interface RankingsBuckets {
  official_men: number
  official_women: number
  race_men: number
  race_women: number
}

export interface RankingsHealthInput {
  now: Date
  latestYear: number | null
  latestWeek: number | null
  latestRankingDate: string | null
  maxCapturedAt: string | null
  buckets: RankingsBuckets
}

export interface RankingsHealthMeta {
  latest_week: string | null
  current_week: string
  weeks_behind: number | null
  ranking_date: string | null
  last_capture: string | null
  official_men: number
  official_women: number
  race_men: number
  race_women: number
}

export interface RankingsHealthResult {
  status: 'ok' | 'partial' | 'error' | 'unknown'
  started_at: string | null
  meta: RankingsHealthMeta
  error_message: string | null
}

// ── Mirrored from padelgod player-rankings.ts (keep in sync) ──────────────

// Core algorithm matches the worker; return omits `mondayIso` (unused here).
export function isoYearWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return { year: date.getUTCFullYear(), week }
}

// Returns the ISO-Monday as date-only 'YYYY-MM-DD' (worker appends 'T00:00:00Z';
// new Date() parses both identically under UTC).
export function weekToDate(year: number, week: number): string {
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const jan1Day = jan1.getUTCDay()
  const dayOffset = (week - 1) * 7 - jan1Day + 1
  const monday = new Date(Date.UTC(year, 0, 1 + dayOffset))
  return monday.toISOString().slice(0, 10)
}

// ── Helpers ───────────────────────────────────────────────────────────────
function weekLabel(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`
}

const DAY_MS = 86400000
// Spans the weekly capture window (rankings publish Mon; worker runs Mon–Sat)
// with margin for weekend gaps and brief outages.
const MAX_CAPTURE_AGE_DAYS = 9

// ── Verdict ─────────────────────────────────────────────────────────────────
export function assessRankingsHealth(input: RankingsHealthInput): RankingsHealthResult {
  const { now, latestYear, latestWeek, latestRankingDate, maxCapturedAt, buckets } = input

  const current = isoYearWeek(now)
  const currentLabel = weekLabel(current.year, current.week)

  const base = {
    started_at: maxCapturedAt,
    meta: {
      latest_week: latestYear != null && latestWeek != null ? weekLabel(latestYear, latestWeek) : null,
      current_week: currentLabel,
      weeks_behind: null as number | null,
      ranking_date: latestRankingDate,
      last_capture: maxCapturedAt,
      official_men: buckets.official_men,
      official_women: buckets.official_women,
      race_men: buckets.race_men,
      race_women: buckets.race_women,
    } satisfies RankingsHealthMeta,
  }

  // Rule 1: no data
  if (latestYear == null || latestWeek == null || maxCapturedAt == null) {
    return { status: 'unknown', ...base, error_message: 'No ranking snapshots found' }
  }

  // Rule 2: dead worker
  const captureAgeDays = (now.getTime() - new Date(maxCapturedAt).getTime()) / DAY_MS
  if (captureAgeDays > MAX_CAPTURE_AGE_DAYS) {
    return {
      status: 'error',
      ...base,
      error_message: `No ranking snapshot in ${Math.floor(captureAgeDays)} days — worker may be down`,
    }
  }

  const weeksBehind = Math.max(
    0,
    Math.round(
      (new Date(weekToDate(current.year, current.week)).getTime() -
        new Date(weekToDate(latestYear, latestWeek)).getTime()) /
        (7 * DAY_MS),
    ),
  )
  base.meta.weeks_behind = weeksBehind

  // Rule 3: current week captured
  if (weeksBehind <= 0) {
    const missing = (
      [
        ['official_men', buckets.official_men],
        ['official_women', buckets.official_women],
        ['race_men', buckets.race_men],
        ['race_women', buckets.race_women],
      ] as const
    )
      .filter(([, n]) => n === 0)
      .map(([name]) => name)

    if (missing.length > 0) {
      return {
        status: 'partial',
        ...base,
        error_message: `Current week captured but missing: ${missing.join(', ')}`,
      }
    }
    return { status: 'ok', ...base, error_message: null }
  }

  // Rule 4: one week behind, early in the week → grace
  const dow = ((now.getUTCDay() + 6) % 7) + 1 // 1 = Mon … 7 = Sun
  // dow 1=Mon, 2=Tue — FIP typically publishes on Monday, so a 1-week lag early in the week is normal
  if (weeksBehind === 1 && dow <= 2) {
    return {
      status: 'partial',
      ...base,
      error_message: 'Awaiting current week — FIP usually publishes Monday',
    }
  }

  // Rule 5: behind and past the grace window
  const latestLabel = weekLabel(latestYear, latestWeek)
  const daysIntoWeek = dow - 1
  return {
    status: 'error',
    ...base,
    error_message: `Current ISO week ${currentLabel} not captured — latest is ${latestLabel}, ${daysIntoWeek} day(s) into the week`,
  }
}
