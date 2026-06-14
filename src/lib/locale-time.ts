// src/lib/locale-time.ts
// Timezone + date utilities for locale-canonical daily pages.
//
// Each locale has a "home timezone" — the canonical TZ we use to define
// what "today" means for URL canonicalisation. This keeps /es/matches/today
// aligned with what a Spanish user expects (Europe/Madrid) even though
// all times in the UI still render in the user's actual device TZ.

const LOCALE_HOME_TZ: Record<string, string> = {
  en: 'UTC',
  es: 'Europe/Madrid',
  pt: 'Europe/Lisbon',
  it: 'Europe/Rome',
  fr: 'Europe/Paris',
}

/** Returns the canonical IANA timezone for a locale. Falls back to UTC. */
export function getLocaleHomeTz(locale: string): string {
  return LOCALE_HOME_TZ[locale] ?? 'UTC'
}

/**
 * Returns today's date in the locale's home timezone as YYYY-MM-DD.
 * Deterministic, SSR-safe, and used for canonical URL resolution.
 */
export function getLocaleTodayIso(locale: string, now: Date = new Date()): string {
  return formatIsoInTz(now, getLocaleHomeTz(locale))
}

/** Offsets a YYYY-MM-DD date by N days, in the given timezone. */
export function addDaysIso(iso: string, days: number, tz: string): string {
  // Parse iso as local midnight in TZ by finding the corresponding UTC instant,
  // then shift by days and re-project.
  const midnightUtc = dateAtTzMidnight(iso, tz)
  const shifted = new Date(midnightUtc.getTime() + days * 86_400_000)
  return formatIsoInTz(shifted, tz)
}

/** Formats a Date as YYYY-MM-DD in the given IANA timezone. */
export function formatIsoInTz(d: Date, tz: string): string {
  // en-CA gives YYYY-MM-DD natively in every locale
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/**
 * Returns the UTC Date representing local midnight of `iso` in `tz`.
 * e.g. dateAtTzMidnight('2026-04-17', 'Europe/Madrid') =
 *      Date at 2026-04-16T22:00:00Z (midnight Madrid time, CEST).
 */
export function dateAtTzMidnight(iso: string, tz: string): Date {
  // Build a Date for iso T 00:00:00 in UTC, then measure the offset between
  // that wall-clock and the tz, and correct. Robust to DST transitions.
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Invalid ISO date: ${iso}`)

  // Start with a UTC midnight of the same wall-clock date.
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0)

  // Work out what wall-clock that UTC instant lands on in the target TZ.
  const asTz = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMidnight))
  const parts: Record<string, string> = {}
  for (const p of asTz) parts[p.type] = p.value
  const tzY = Number(parts.year)
  const tzM = Number(parts.month)
  const tzD = Number(parts.day)
  const tzH = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  const tzMin = Number(parts.minute)
  const tzS = Number(parts.second)

  const tzWallAsUtc = Date.UTC(tzY, tzM - 1, tzD, tzH, tzMin, tzS, 0)
  const tzOffsetMs = tzWallAsUtc - utcMidnight

  // If the TZ wall-clock is ahead of UTC, the UTC instant corresponding to
  // tz-midnight is earlier by tzOffsetMs. So:
  return new Date(utcMidnight - tzOffsetMs)
}

/**
 * Returns [startUtc, endUtc) — the UTC window covering the full day `iso`
 * in timezone `tz`. Use this to query "matches happening today in Spain".
 */
export function localDayRangeUtc(iso: string, tz: string): { startUtc: Date; endUtc: Date } {
  const startUtc = dateAtTzMidnight(iso, tz)
  const endUtc = new Date(startUtc.getTime() + 86_400_000)
  return { startUtc, endUtc }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True if `s` is a well-formed YYYY-MM-DD. Does not validate month/day ranges. */
export function isIsoDate(s: string): boolean {
  return ISO_DATE_RE.test(s)
}

/**
 * Resolves a date segment from the URL — either a literal YYYY-MM-DD or
 * one of the keyword aliases today/yesterday/tomorrow — to a canonical
 * YYYY-MM-DD in the locale's home timezone. Returns null for invalid input.
 */
export function resolveDateSegment(
  segment: string,
  locale: string,
  now: Date = new Date(),
): string | null {
  const tz = getLocaleHomeTz(locale)
  const today = getLocaleTodayIso(locale, now)
  switch (segment) {
    case 'today':     return today
    case 'yesterday': return addDaysIso(today, -1, tz)
    case 'tomorrow':  return addDaysIso(today, 1, tz)
    default:          return isIsoDate(segment) ? segment : null
  }
}

/**
 * Returns true if `iso` is the locale's "today". Used to choose between
 * "Hoy" pill and absolute-date pill formatting.
 */
export function isLocaleToday(iso: string, locale: string, now: Date = new Date()): boolean {
  return iso === getLocaleTodayIso(locale, now)
}

/**
 * Canonical (locale-neutral) path for a /matches day page.
 *
 * "Today" consolidates onto the permanent /matches hub so SEO authority
 * accumulates on one stable URL; every other day owns its dated archive
 * URL. Consumed by the daily-page layout's canonical/hreflang and by the
 * page's JSON-LD `url`.
 */
export function matchesCanonicalPath(
  iso: string,
  locale: string,
  now: Date = new Date(),
): string {
  return isLocaleToday(iso, locale, now) ? '/matches' : `/matches/${iso}`
}
