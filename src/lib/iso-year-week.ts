// src/lib/iso-year-week.ts
// ISO 8601 year-week formatter — Thursday's year decides the week's year,
// week 1 contains Jan 4. Mirrors the same algorithm padelgod's worker uses
// (see padelgod/src/workers/player-rankings.ts isoYearWeek), so both the
// Next.js app and the worker produce the same "YYYY-WW" string for any
// given Monday.

export function isoYearWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // shift to Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return { year: date.getUTCFullYear(), week }
}

/**
 * Format a date (string or Date) as "YYYY-WW" using ISO 8601 week numbering.
 * Returns null if the input can't be parsed.
 */
export function formatYearWeek(input: string | Date | null | undefined): string | null {
  if (!input) return null
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return null
  const { year, week } = isoYearWeek(d)
  return `${year}-${String(week).padStart(2, '0')}`
}
