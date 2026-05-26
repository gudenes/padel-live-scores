/**
 * Pure utilities for the home page's Live Tournaments carousel.
 *
 * - compareTournamentsForCarousel: sort comparator using the canonical
 *   levelTierWeight (Premier first, then FIP in tier order), tie-broken
 *   by ascending starts_at.
 * - buildMatchInfoMap: aggregate raw matches-today rows into per-tournament
 *   { matchesToday }. We no longer key off per-match status because the
 *   carousel's LIVE chip is purely a presence indicator (tournament is
 *   running today) — see 2026-05-21-carousel-live-chip-simplification-design.md.
 * - getLocalDayBoundaryUTC: compute today's [startUTC, endUTC] window in the
 *   user's local timezone, suitable for filtering matches.scheduled_at.
 * - hasStarted: predicate the carousel card uses to branch its status line
 *   between live-today/rest-day copy and upcoming-event copy.
 * - daysUntilStart: whole-day diff from today (user local) to the tournament's
 *   start day. Used by the upcoming-event copy to render "Starts in N days /
 *   tomorrow / today".
 */

import { levelTierWeight } from './tournament-labels'

export interface TournamentForSort {
  id: string
  level: string | null
  starts_at: string
}

export interface MatchForAggregation {
  tournament_id: string
}

export interface MatchInfo {
  matchesToday: number
}

export function compareTournamentsForCarousel(
  a: TournamentForSort,
  b: TournamentForSort,
): number {
  const aRank = levelTierWeight(a.level)
  const bRank = levelTierWeight(b.level)
  if (aRank !== bRank) return aRank - bRank
  return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
}

export function buildMatchInfoMap(
  rows: MatchForAggregation[],
): Map<string, MatchInfo> {
  const out = new Map<string, MatchInfo>()
  for (const r of rows) {
    let entry = out.get(r.tournament_id)
    if (!entry) {
      entry = { matchesToday: 0 }
      out.set(r.tournament_id, entry)
    }
    entry.matchesToday += 1
  }
  return out
}

export function getLocalDayBoundaryUTC(now: Date = new Date()): {
  startUTC: string
  endUTC: string
} {
  // Build a YYYY-MM-DD string for the user's local day. `en-CA` formats as
  // ISO-style (YYYY-MM-DD) regardless of host locale, avoiding parse quirks.
  const localDateStr = now.toLocaleDateString('en-CA')
  // Bare `YYYY-MM-DDTHH:mm:ss` is parsed as local time; toISOString() converts to UTC.
  const start = new Date(`${localDateStr}T00:00:00`)
  const end = new Date(`${localDateStr}T23:59:59.999`)
  return {
    startUTC: start.toISOString(),
    endUTC: end.toISOString(),
  }
}

/**
 * True iff the tournament has begun. Used by the carousel card to branch
 * between "live today / rest day" status lines and "starts in N days /
 * tomorrow / today" status lines. The "equal to now" edge case resolves
 * to true so a tournament whose listed start time is exactly `now` shows
 * the live-today branch rather than flicker into the upcoming branch.
 */
export function hasStarted(startsAt: string, now: Date = new Date()): boolean {
  return new Date(startsAt).getTime() <= now.getTime()
}

/**
 * Whole-day diff between today (user local) and the calendar day of the
 * tournament's `starts_at`. Returns:
 *   0  → starts today (including earlier today; caller is expected to branch
 *        on hasStarted first if it cares about "already started")
 *   1  → starts tomorrow
 *   N  → starts in N days
 *
 * Uses local-time calendar-day comparison via toLocaleDateString('en-CA'),
 * which produces a stable YYYY-MM-DD string regardless of host locale and
 * is DST-safe (DST shifts the wall clock but not the calendar date).
 */
export function daysUntilStart(startsAt: string, now: Date = new Date()): number {
  const toLocalDateStr = (d: Date) => d.toLocaleDateString('en-CA')
  // Parse YYYY-MM-DDT00:00:00 as local time so the diff is in calendar days,
  // not 24h chunks (which would drift on DST transitions).
  const startOfDay = (s: string) => new Date(`${s}T00:00:00`).getTime()
  const todayMs = startOfDay(toLocalDateStr(now))
  const startMs = startOfDay(toLocalDateStr(new Date(startsAt)))
  // Round to nearest whole day to absorb any sub-millisecond noise from
  // DST math on the underlying Date object.
  return Math.round((startMs - todayMs) / 86_400_000)
}
