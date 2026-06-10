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

/**
 * Sort weight for operator-curated managed events on the rail. Placed
 * between the lowest Premier tier (p2 = 3) and the first FIP tier
 * (fip_platinum = 4) so a managed event (e.g. Reserve Cup) sits AFTER
 * the Premier Padel events but AHEAD of the FIP tiers — date breaks ties
 * within the same weight.
 */
export const MANAGED_EVENT_TIER_WEIGHT = 3.5

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

/**
 * Minimal shape needed to bucket + date-position a carousel card. Both
 * real tournament cards and managed-event cards satisfy this.
 */
export interface CarouselBucketable {
  starts_at: string
  ends_at?: string | null
  level?: string | null
  champions?: { men?: unknown; women?: unknown }
  /** Present only on operator-curated managed-event cards. */
  managedEvent?: unknown
}

/** Tier sort weight: managed events get the Premier-adjacent weight. */
function tierWeightOf(t: CarouselBucketable): number {
  return t.managedEvent ? MANAGED_EVENT_TIER_WEIGHT : levelTierWeight(t.level ?? null)
}

/**
 * Rail bucket rank: 0 = LIVE (running/today), 1 = UPCOMING, 2 = CROWNED/
 * finished. Mirrors the home carousel's `bucketOf`. For managed events
 * (no per-match `champions` feed) a past `ends_at` is what marks them
 * finished — without this a finished managed event would read as "live".
 */
export function carouselBucketRank(t: CarouselBucketable, now: Date = new Date()): 0 | 1 | 2 {
  const bothCrowned = !!(t.champions?.men && t.champions?.women)
  if (bothCrowned) return 2
  if (!hasStarted(t.starts_at, now)) return 1
  if (t.managedEvent && t.ends_at && new Date(t.ends_at).getTime() < now.getTime()) return 2
  return 0
}

/**
 * Insert managed-event cards into an already-bucketed/sorted carousel
 * list, positioned by their own bucket then start date — instead of
 * pinning them to the front. Keeps the existing tournament-vs-tournament
 * order untouched: a managed event lands after any LIVE card and among
 * UPCOMING cards by date (e.g. Reserve Cup on Jun 18 sits after a live
 * Premier event and before an upcoming event starting Jun 22).
 */
export function insertManagedCardsByDate<T extends CarouselBucketable>(
  decorated: T[],
  managed: T[],
  now: Date = new Date(),
): T[] {
  const out = [...decorated]
  // Insert in date order so multiple managed events keep chronological
  // order among themselves at the same tier weight.
  const ordered = [...managed].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  )
  for (const card of ordered) {
    const cb = carouselBucketRank(card, now)
    const ct = tierWeightOf(card)
    const cs = new Date(card.starts_at).getTime()
    // Find the first existing card that should sort AFTER this one, using
    // the same (bucket → tier weight → start date) key the rail orders by.
    let idx = out.findIndex(t => {
      const tb = carouselBucketRank(t, now)
      if (tb !== cb) return tb > cb
      const tt = tierWeightOf(t)
      if (tt !== ct) return tt > ct
      return new Date(t.starts_at).getTime() > cs
    })
    if (idx === -1) idx = out.length
    out.splice(idx, 0, card)
  }
  return out
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
