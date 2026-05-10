// src/lib/tournament-day-indicator.ts
//
// Decides whether a finished match should display a tournament-local
// day chip on the matches-by-date list. Required because the day-tab
// is a user-local construct (URL `[date]` interpreted in geo-timezone)
// but the tournament narrative ("Saturday's semifinals") is
// tournament-local. When those disagree the chip surfaces the
// tournament-local short date so users understand why a finished
// match is appearing under "today" alongside still-upcoming ones.
//
// Pure module — no React, no DOM. Consumed by MatchCard.tsx.

const TERMINAL_STATUSES = new Set(['finished', 'retired', 'walkover', 'ended'])

export interface ShouldShowDayIndicatorInput {
  status: string
  finishedAt: string | null
  scheduledAt: string | null
  tournamentTimezone: string | null
  /** ISO date (YYYY-MM-DD) of the matches-list day-tab the user has
   *  selected. Undefined when the card is rendered outside the
   *  matches-list page (tournament detail, match detail) — in which
   *  case the chip never fires. */
  dayBucketIso: string | undefined
}

/**
 * Returns the canonical YYYY-MM-DD string for a UTC timestamp in the
 * given timezone. Uses Intl with the en-CA locale because en-CA's
 * `toLocaleDateString` shape is ISO-style (YYYY-MM-DD).
 */
function isoDateInTz(utcIso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  }).format(new Date(utcIso))
}

export function shouldShowDayIndicator(input: ShouldShowDayIndicatorInput): boolean {
  const { status, finishedAt, scheduledAt, tournamentTimezone, dayBucketIso } = input
  if (!dayBucketIso) return false
  if (!TERMINAL_STATUSES.has(status)) return false
  if (!tournamentTimezone) return false
  const ref = finishedAt ?? scheduledAt
  if (!ref) return false
  let tournamentDay: string
  try {
    tournamentDay = isoDateInTz(ref, tournamentTimezone)
  } catch {
    return false
  }
  return tournamentDay !== dayBucketIso
}

export interface FormatDayChipLabelInput {
  timestamp: string | null
  tournamentTimezone: string | null
  locale: string
}

/**
 * Localised short label for the chip — "Sáb 9 mai." (pt), "Sat 9 May" (en).
 * Returns null when inputs are insufficient, so the caller can render
 * nothing without an extra guard.
 */
export function formatDayChipLabel(input: FormatDayChipLabelInput): string | null {
  const { timestamp, tournamentTimezone, locale } = input
  if (!timestamp || !tournamentTimezone) return null
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: tournamentTimezone,
    }).format(new Date(timestamp))
  } catch {
    return null
  }
}
