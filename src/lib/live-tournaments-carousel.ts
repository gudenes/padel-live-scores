/**
 * Pure utilities for the home page's Live Tournaments carousel.
 *
 * - compareTournamentsForCarousel: sort comparator. Premier tiers first by
 *   static rank, then FIP tiers, then ascending starts_at.
 * - buildMatchInfoMap: aggregate raw matches-today rows into per-tournament
 *   { matchesToday, hasLiveMatch }.
 * - getLocalDayBoundaryUTC: compute today's [startUTC, endUTC] window in the
 *   user's local timezone, suitable for filtering matches.scheduled_at.
 */

export const TIER_RANK: Record<string, number> = {
  p1: 1,
  p2: 2,
  major: 3,
  finals: 4,
  gold: 5,
  bronze: 6,
  rise: 7,
  future: 8,
}

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
  const aRank = TIER_RANK[a.level ?? ''] ?? 99
  const bRank = TIER_RANK[b.level ?? ''] ?? 99
  if (aRank !== bRank) return aRank - bRank
  return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
}

export function buildMatchInfoMap(
  rows: MatchForAggregation[],
): Map<string, MatchInfo> {
  const out = new Map<string, MatchInfo>()
  for (const r of rows) {
    const entry = out.get(r.tournament_id) ?? { matchesToday: 0, hasLiveMatch: false }
    entry.matchesToday += 1
    if (r.status === 'live' || r.status === 'on_court') entry.hasLiveMatch = true
    out.set(r.tournament_id, entry)
  }
  return out
}

export function getLocalDayBoundaryUTC(now: Date = new Date()): {
  startUTC: string
  endUTC: string
} {
  const localDateStr = now.toLocaleDateString('en-CA')
  const start = new Date(`${localDateStr}T00:00:00`)
  const end = new Date(`${localDateStr}T23:59:59.999`)
  return {
    startUTC: start.toISOString(),
    endUTC: end.toISOString(),
  }
}
