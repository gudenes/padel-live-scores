// src/lib/fetch-matches-calendar.ts
//
// "Calendar metadata" lookup for the day picker on /matches/[date].
// Driven by user feedback: people would scroll the day picker forward
// looking for matches, hit empty day after empty day, and bounce.
//
// We answer two product questions in one DB round-trip:
//
//   1. How far forward should the day picker let users scroll?
//      → `maxScheduledIso` is the latest day with a `scheduled_at` in
//        the future. The shell caps the picker at
//        `max(today + 3, maxScheduledIso)` so users can always hop
//        ±3 days but can't scroll past where data ends.
//
//   2. From any given day, what's the next day with matches?
//      → `daysWithMatches` is a sorted ISO list of every day that has
//        ≥1 match scheduled in the next ~30 days. The empty-state CTA
//        on /matches/[date] uses it to render
//        "Next matches: <date> →" so users jump there in one tap.
//
// Both answers come from a single grouped scheduled_at scan limited to
// today..today+30. PostgREST doesn't expose `GROUP BY`, so we issue a
// thin SELECT and bucket on the JS side; with `limit=2000` and an index
// on `scheduled_at` this stays well under 50ms.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addDaysIso,
  dateAtTzMidnight,
  formatIsoInTz,
  getLocaleTodayIso,
} from './locale-time'

/** How far ahead we look for "next match" data. 30 days covers any
 *  realistic upcoming Premier event without pulling unbounded rows. */
const LOOKAHEAD_DAYS = 30

/** Max rows pulled per call. With ~25 events/week and 64 matches/event
 *  the upper bound for a 30-day window is ~6 800 — but most of those
 *  are already finished and excluded by the `gte: today` filter. */
const SELECT_LIMIT = 2000

export interface MatchesCalendarPayload {
  /** ISO YYYY-MM-DD list (in the locale's home tz) of every day in the
   *  next 30 days that has at least one scheduled match. Sorted ascending. */
  daysWithMatches: string[]
  /** Latest day in the window with at least one scheduled match. Null
   *  when the lookahead window is completely empty. The shell caps the
   *  forward day picker at `max(today + 3, maxScheduledIso)`. */
  maxScheduledIso: string | null
  /** ISO YYYY-MM-DD of "today" in the locale's home tz. Echoed back so
   *  the client doesn't have to derive it independently. */
  todayIso: string
  /** True when there is at least one match currently in `live` or
   *  `on_court` state. Drives the LIVE pill's tap behaviour: tap with
   *  `hasLiveNow=true` jumps to today and filters; tap with `false`
   *  surfaces a toast instead of stranding the user on an empty filter. */
  hasLiveNow: boolean
}

/**
 * Pull the calendar metadata for the day-picker boundary + jump CTA.
 *
 * Failure mode is deliberately forgiving: any DB error returns an
 * empty calendar so the picker gracefully falls back to "no boundary"
 * (the UX the page had before this feature). Logged + reported, not
 * thrown — a stale picker beats a 500.
 */
export async function fetchMatchesCalendar(
  supabase: SupabaseClient,
  locale: string,
  tz: string,
  now: Date = new Date(),
): Promise<MatchesCalendarPayload> {
  const todayIso = getLocaleTodayIso(locale, now)

  // Build the UTC window covering [today, today+30) in the locale's tz.
  // We deliberately use today's start rather than `now` so a match
  // scheduled for "later today" still counts as "today has matches".
  const todayStartUtc = dateAtTzMidnight(todayIso, tz)
  const horizonIso = addDaysIso(todayIso, LOOKAHEAD_DAYS, tz)
  const horizonStartUtc = dateAtTzMidnight(horizonIso, tz)

  // Two queries in parallel: window scan for the picker + a cheap count
  // of in-play matches for the LIVE pill's tap-or-toast decision. The
  // count uses `head:true` so PostgREST returns only the row count, not
  // the rows themselves.
  const [windowRes, liveRes] = await Promise.all([
    supabase
      .from('matches')
      .select('scheduled_at')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', todayStartUtc.toISOString())
      .lt('scheduled_at', horizonStartUtc.toISOString())
      .limit(SELECT_LIMIT),
    supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .in('status', ['live', 'on_court']),
  ])

  if (windowRes.error) {
    console.error('[fetchMatchesCalendar] read failed:', windowRes.error.message)
    return {
      daysWithMatches: [],
      maxScheduledIso: null,
      todayIso,
      hasLiveNow: false,
    }
  }

  // Bucket scheduled_at instants into local-tz day strings.
  const seen = new Set<string>()
  for (const row of (windowRes.data ?? []) as Array<{ scheduled_at: string | null }>) {
    if (!row.scheduled_at) continue
    const day = formatIsoInTz(new Date(row.scheduled_at), tz)
    seen.add(day)
  }

  const sorted = Array.from(seen).sort()
  const maxScheduledIso = sorted.length > 0 ? sorted[sorted.length - 1] : null
  const hasLiveNow = !liveRes.error && (liveRes.count ?? 0) > 0
  return { daysWithMatches: sorted, maxScheduledIso, todayIso, hasLiveNow }
}

/**
 * Find the next ISO ≥ `fromIso` that's in `daysWithMatches`. Returns
 * null when there's nothing scheduled at or after `fromIso` in the
 * window. Used by the empty-state CTA: we render
 * "Next matches: <result>" pointing the user to the soonest non-empty
 * day so they don't have to scroll for it.
 */
export function nextDayWithMatches(
  daysWithMatches: readonly string[],
  fromIso: string,
): string | null {
  // daysWithMatches is sorted ascending — linear scan is faster than
  // binary search at the typical sizes (≤30 entries) and avoids a
  // dependency. Bail on first match.
  for (const d of daysWithMatches) {
    if (d >= fromIso) return d
  }
  return null
}
