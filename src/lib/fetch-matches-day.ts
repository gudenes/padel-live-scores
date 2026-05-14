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
import { localDayRangeUtc, isIsoDate, formatIsoInTz } from './locale-time'
import { hydrateThinPlayers } from './thin-match-player'
import {
  isPremierLevel,
  levelTierWeight,
  mostAdvancedRoundEntry,
} from './tournament-labels'

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
  court_order: number | null
  schedule_label: string | null
  winner_pair: number | null
  pair1_seed: number | null
  pair2_seed: number | null
  tournament: {
    id: string
    name: string
    level: string | null
    country: string | null
    timezone: string | null
    starts_at: string | null
    ends_at: string | null
    status: string | null
  } | null
  pair1_player1: MatchesDayPlayer | null
  pair1_player2: MatchesDayPlayer | null
  pair2_player1: MatchesDayPlayer | null
  pair2_player2: MatchesDayPlayer | null
  // Raw name + country strings written by the populator for amateur-
  // tier tournaments where FIP-ID resolution failed. The hydrator
  // turns these into synthetic Player objects with id='' before the
  // payload reaches the UI; consumers should never need to read them
  // directly. Country is the IOC/FIP code (INA, HKG, ESP, …) — same
  // representation `players.country` uses.
  pair1_player1_name?: string | null
  pair1_player2_name?: string | null
  pair2_player1_name?: string | null
  pair2_player2_name?: string | null
  pair1_player1_country?: string | null
  pair1_player2_country?: string | null
  pair2_player1_country?: string | null
  pair2_player2_country?: string | null
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
  id, status, category, scheduled_at, finished_at, duration, round, court, court_order,
  schedule_label, winner_pair, late_hint, pair1_seed, pair2_seed,
  pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
  pair1_player1_country, pair1_player2_country, pair2_player1_country, pair2_player2_country,
  tournament:tournaments(id, name, level, country, timezone, starts_at, ends_at, status),
  ${PLAYER_JOIN_FIELDS},
  sets(id, set_number, set_score, pair1_games, pair2_games, is_current,
       games(id, game_number, game_score, points, is_current, server_player_id))
`

// Tier priority for tournament groups within a section uses the
// canonical `levelTierWeight()` from tournament-labels — same map
// the home Tournaments view + spotlight picker use, so the order is
// consistent across the app: Premier (finals/major/p1/p2) first,
// then Platinum, Gold, Silver, Bronze, Promises, Beyond.

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

  // When the requested day is today (in the window TZ), include all
  // currently-live matches regardless of scheduled_at. A match whose
  // scheduled_at is on yesterday or tomorrow can be live right now —
  // started late and crossed midnight, started early before its
  // scheduled time, or has a default scheduled_at that lands outside
  // the user-TZ day window. The home page's "Live now" carousel and
  // the bottom-nav badge already include all live matches; this
  // closes the gap so today's tab sees the same set.
  const isToday = iso === formatIsoInTz(new Date(), tz)

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
        ).toISOString()})` +
        (isToday ? `,status.in.(live,on_court)` : ''),
    )
    .order('scheduled_at', { ascending: true })
    .limit(400)

  if (error) {
    console.error('[fetchMatchesDay] fetch failed:', error.message)
    return { iso, groups: [], totalMatches: 0 }
  }

  const matches = ((rawMatches ?? []) as unknown as MatchesDayMatch[])
    .filter((m) => !!m.tournament)
    // Synthesize thin Player objects in any pair slot whose FK is null
    // but `pair*_player*_name` is populated. Amateur-tier tournaments
    // (FIP Beyond / Promises / Other) rely on this to render at all.
    .map((m) => hydrateThinPlayers(m))

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
    (m) =>
      (m.status === 'live' || m.status === 'on_court') &&
      (isToday || inWindow(m.scheduled_at)),
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

  // Combined sort: Premier-first + progression.
  //
  //   1. Hard tier bucket — Premier (Major/P1/P2/Finals) always above
  //      FIP-tier tournaments. No progression on a Bronze final can
  //      leapfrog a Premier event still in qualifying.
  //   2. Inside each bucket — sort by today's most-advanced round
  //      (Final → SF → QF → R16 → R32 → R64 → R128 → Q3 → Q2 → Q1).
  //      Climactic content surfaces above earlier-stage content within
  //      the same tier bucket.
  //   3. Sub-tiebreaker — existing tier weight (P1 above P2 above
  //      Major-by-numeric-tier; Bronze above Promises etc. inside FIP).
  //      Keeps stable ordering when stage + bucket are equal.
  groups.sort((a, b) => {
    const aPrem = isPremierLevel(a.tournamentLevel) ? 0 : 1
    const bPrem = isPremierLevel(b.tournamentLevel) ? 0 : 1
    if (aPrem !== bPrem) return aPrem - bPrem
    const aRank = mostAdvancedRoundEntry(a.matches).rank
    const bRank = mostAdvancedRoundEntry(b.matches).rank
    if (aRank !== bRank) return aRank - bRank
    return levelTierWeight(a.tournamentLevel) - levelTierWeight(b.tournamentLevel)
  })

  return { iso, groups, totalMatches: dayMatches.length }
}
