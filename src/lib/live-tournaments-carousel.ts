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
 * - hasStarted / daysUntilStart: predicates for the UPCOMING-card branch,
 *   used by tournaments whose starts_at is in the future but within the
 *   carousel's 7-day forward window.
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

export function hasStarted(startsAt: string, now: Date = new Date()): boolean {
  return new Date(startsAt).getTime() <= now.getTime()
}

export function daysUntilStart(startsAt: string, now: Date = new Date()): number {
  // Whole-day calendar diff in the user's local timezone. We render
  // YYYY-MM-DD strings via en-CA, parse them as local midnight, and
  // divide the millisecond gap by 24h. Math.round (not floor) covers
  // DST transitions where the gap is 23h or 25h instead of 24h.
  const fmt = (d: Date) => d.toLocaleDateString('en-CA')
  const startMidnight = new Date(`${fmt(new Date(startsAt))}T00:00:00`)
  const nowMidnight = new Date(`${fmt(now)}T00:00:00`)
  return Math.round((startMidnight.getTime() - nowMidnight.getTime()) / 86_400_000)
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
