// src/lib/fetch-matches-day.ts
//
// Shared fetcher for the matches-by-date listing. Pulls matches whose
// scheduled_at OR finished_at falls in a given day's UTC window, buckets
// them into live / upcoming / finished, groups by tournament, and sorts
// the groups by tier (Premier first, FIP cascade after).
//
// Used by:
//   - the SSR matches page (`src/app/[locale]/(app)/matches/[date]/page.tsx`)
//   - the client-side day-swap API (`src/app/api/matches/by-date/route.ts`)
//
// Shape stays JSON-serialisable so the API route can return it verbatim
// and the client cache can hydrate without reprocessing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { localDayRangeUtc, isIsoDate } from './locale-time'

const ONE_DAY_MS = 86_400_000

export interface MatchesDayPlayer {
  id: string
  name: string | null
  display_name: string | null
  country: string | null
  ranking: number | null
}

export interface MatchesDaySet {
  id: string
  set_number: number | null
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  is_current: boolean | null
}

export interface MatchesDayMatch {
  id: string
  status: string
  category: string | null
  scheduled_at: string | null
  finished_at: string | null
  round: string | null
  court: string | null
  schedule_label: string | null
  winner_pair: number | null
  tournament: {
    id: string
    name: string
    level: string | null
    country: string | null
    starts_at: string | null
    ends_at: string | null
    status: string | null
  } | null
  pair1_player1: MatchesDayPlayer | null
  pair1_player2: MatchesDayPlayer | null
  pair2_player1: MatchesDayPlayer | null
  pair2_player2: MatchesDayPlayer | null
  sets: MatchesDaySet[] | null
}

export interface MatchesDayGroup {
  tournamentId: string
  tournamentName: string
  tournamentLevel: string | null
  tournamentCountry: string | null
  tournamentStartsAt: string | null
  tournamentEndsAt: string | null
  tournamentStatus: string | null
  matches: MatchesDayMatch[]
  isPremier: boolean
}

export interface MatchesDayPayload {
  iso: string
  groups: MatchesDayGroup[]
  totalMatches: number
}

const PLAYER_JOIN_FIELDS = `
  pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, ranking),
  pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, ranking),
  pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, ranking),
  pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, ranking)
`

const MATCH_SELECT = `
  id, status, category, scheduled_at, finished_at, round, court,
  schedule_label, winner_pair,
  tournament:tournaments(id, name, level, country, starts_at, ends_at, status),
  ${PLAYER_JOIN_FIELDS},
  sets(id, set_number, set_score, pair1_games, pair2_games, is_current)
`

// Tier priority for tournament groups within a section. Mirrors the
// page-level constant — kept here so the helper is self-contained.
const TIER_ORDER: Record<string, number> = {
  major: 0,
  finals: 0,
  p1: 0,
  p2: 0,
  wpt_final: 0,
  wpt_1000: 0,
  wpt_master: 0,
  wpt_500: 0,
  fip_platinum: 1,
  fip_gold: 2,
  fip_silver: 3,
  fip_other: 4,
}

function tournamentTierRank(level: string | null): number {
  if (!level) return 99
  return TIER_ORDER[level] ?? 99
}

function isPremierLevel(level: string | null): boolean {
  return tournamentTierRank(level) === 0
}

/**
 * Fetch + bucket + group matches for a single ISO day in the locale's
 * home timezone. Returns a JSON-serialisable payload.
 *
 * Throws on invalid `iso` so callers don't silently get an empty set.
 * Logs and returns an empty payload on Supabase errors — same
 * forgiving behaviour the SSR page used.
 */
export async function fetchMatchesDay(
  supabase: SupabaseClient,
  iso: string,
  tz: string,
): Promise<MatchesDayPayload> {
  if (!isIsoDate(iso)) {
    throw new Error(`fetchMatchesDay: invalid ISO date ${iso}`)
  }

  const { startUtc, endUtc } = localDayRangeUtc(iso, tz)
  const startIso = startUtc.toISOString()
  const endIso = endUtc.toISOString()

  // Widen finished_at upper bound by 7 days to catch matches whose
  // finished_at got stamped late by a padelgod writer. The
  // `effectiveFinishedAt` clamp pulls those rows back to their
  // tournament's ends_at so they show up on the correct day. See SSR
  // page comments for the full story.
  const { data: rawMatches, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .or(
      `and(scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
        `and(finished_at.gte.${startIso},finished_at.lt.${new Date(
          endUtc.getTime() + 7 * ONE_DAY_MS,
        ).toISOString()})`,
    )
    .order('scheduled_at', { ascending: true })
    .limit(400)

  if (error) {
    console.error('[fetchMatchesDay] fetch failed:', error.message)
    return { iso, groups: [], totalMatches: 0 }
  }

  const matches = ((rawMatches ?? []) as unknown as MatchesDayMatch[]).filter(
    (m) => !!m.tournament,
  )

  const inWindow = (s: string | null): boolean => {
    if (!s) return false
    const t = Date.parse(s)
    return !Number.isNaN(t) && t >= startUtc.getTime() && t < endUtc.getTime()
  }

  const effectiveFinishedAt = (m: MatchesDayMatch): string | null => {
    if (!m.finished_at) return null
    const tournamentEnds = m.tournament?.ends_at
    if (!tournamentEnds) return m.finished_at
    const finishedT = Date.parse(m.finished_at)
    const tournamentEndT = Date.parse(tournamentEnds)
    if (Number.isNaN(finishedT) || Number.isNaN(tournamentEndT)) return m.finished_at
    if (finishedT > tournamentEndT + ONE_DAY_MS) return tournamentEnds
    return m.finished_at
  }

  const live = matches.filter(
    (m) => (m.status === 'live' || m.status === 'on_court') && inWindow(m.scheduled_at),
  )
  const upcoming = matches.filter(
    (m) => m.status === 'scheduled' && inWindow(m.scheduled_at),
  )
  const finished = matches.filter(
    (m) =>
      ['finished', 'retired', 'walkover'].includes(m.status) &&
      inWindow(effectiveFinishedAt(m)),
  )
  const dayMatches = [...live, ...upcoming, ...finished]

  // Group by tournament, preserving insertion order (which inherits
  // from match scheduled_at ascending).
  const groupMap = new Map<string, MatchesDayGroup>()
  for (const m of dayMatches) {
    const t = m.tournament
    if (!t) continue
    const existing = groupMap.get(t.id)
    if (existing) {
      existing.matches.push(m)
    } else {
      groupMap.set(t.id, {
        tournamentId: t.id,
        tournamentName: t.name,
        tournamentLevel: t.level,
        tournamentCountry: t.country,
        tournamentStartsAt: t.starts_at,
        tournamentEndsAt: t.ends_at,
        tournamentStatus: t.status,
        matches: [m],
        isPremier: isPremierLevel(t.level),
      })
    }
  }

  const groups = Array.from(groupMap.values())
  groups.sort(
    (a, b) =>
      tournamentTierRank(a.tournamentLevel) - tournamentTierRank(b.tournamentLevel),
  )

  return { iso, groups, totalMatches: dayMatches.length }
}
