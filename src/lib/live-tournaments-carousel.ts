/**
 * Pure utilities for the home page's Live Tournaments carousel.
 *
 * - compareTournamentsForCarousel: sort comparator using the canonical
 *   levelTierWeight (Premier first, then FIP in tier order), tie-broken
 *   by ascending starts_at.
 * - buildMatchInfoMap: aggregate raw matches-today rows into per-tournament
 *   { matchesToday, hasLiveMatch }. Uses the canonical isLiveStatus helper.
 * - getLocalDayBoundaryUTC: compute today's [startUTC, endUTC] window in the
 *   user's local timezone, suitable for filtering matches.scheduled_at.
 */

import { levelTierWeight } from './tournament-labels'
import { isLiveStatus } from './tournament-tier'

export interface TournamentForSort {
  id: string
  level: string | null
  starts_at: string
}

export interface MatchForAggregation {
  tournament_id: string
  status: string
}

export interface MatchInfo {
  matchesToday: number
  hasLiveMatch: boolean
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
      entry = { matchesToday: 0, hasLiveMatch: false }
      out.set(r.tournament_id, entry)
    }
    entry.matchesToday += 1
    if (isLiveStatus(r.status)) entry.hasLiveMatch = true
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
