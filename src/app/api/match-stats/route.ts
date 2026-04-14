// src/app/api/match-stats/route.ts
//
// Public GET endpoint for the Stats tab on match detail.
// Returns { stats: MatchStatsRow[] | null, status }.
//
// Stats sources (in priority order):
//   1. Local DB (match_stats table) — cached stats from any source
//   2. PadelAPI live fetch — /api/matches/{padelapi_id}/stats
//
// Status values:
//   'ok'           — stats present
//   'upcoming'     — match hasn't started yet
//   'unavailable'  — no stats available for this match

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const PADELAPI_TOKEN = process.env.PADELAPI_TOKEN

type StatsStatus = 'ok' | 'unavailable' | 'upcoming'

/** Parse "66%" → 66, or "6" → 6 */
function parseStatValue(val: string | undefined | null): number | null {
  if (val == null) return null
  const n = parseInt(val.replace('%', ''))
  return isNaN(n) ? null : n
}

/** Convert padelapi stats block to our DB row format */
function mapApiStatsToRow(
  matchId: string,
  setNumber: number,
  block: Record<string, { team_1: string; team_2: string }>,
) {
  // For percentage fields: store as value out of 100
  // For count fields: store as raw number (total = null)
  const pct = (field: string, team: 'team_1' | 'team_2') => {
    const val = block[field]?.[team]
    return parseStatValue(val)
  }

  return {
    match_id: matchId,
    set_number: setNumber,
    // Serve stats
    team1_first_serve_won: pct('won_on_1st_serve', 'team_1'),
    team1_first_serve_played: 100,
    team1_second_serve_won: pct('won_on_2nd_serve', 'team_1'),
    team1_second_serve_played: 100,
    team1_service_games: pct('service_games', 'team_1'),
    team2_first_serve_won: pct('won_on_1st_serve', 'team_2'),
    team2_first_serve_played: 100,
    team2_second_serve_won: pct('won_on_2nd_serve', 'team_2'),
    team2_second_serve_played: 100,
    team2_service_games: pct('service_games', 'team_2'),
    // Return stats
    team1_first_return_won: pct('won_on_1st_return', 'team_1'),
    team1_first_return_played: 100,
    team1_second_return_won: pct('won_on_2nd_return', 'team_1'),
    team1_second_return_played: 100,
    team1_return_games: pct('return_games', 'team_1'),
    team2_first_return_won: pct('won_on_1st_return', 'team_2'),
    team2_first_return_played: 100,
    team2_second_return_won: pct('won_on_2nd_return', 'team_2'),
    team2_second_return_played: 100,
    team2_return_games: pct('return_games', 'team_2'),
    // Totals
    team1_total_points_won: pct('total_points_won', 'team_1'),
    team1_total_points_played: 100,
    team1_serve_points_won: pct('total_won_on_serve', 'team_1'),
    team1_serve_points_played: 100,
    team1_return_points_won: pct('total_won_on_return', 'team_1'),
    team1_return_points_played: 100,
    team1_longest_streak: pct('longest_streak', 'team_1'),
    team2_total_points_won: pct('total_points_won', 'team_2'),
    team2_total_points_played: 100,
    team2_serve_points_won: pct('total_won_on_serve', 'team_2'),
    team2_serve_points_played: 100,
    team2_return_points_won: pct('total_won_on_return', 'team_2'),
    team2_return_points_played: 100,
    team2_longest_streak: pct('longest_streak', 'team_2'),
    // Metadata
    source: 'padelapi',
    source_match_id: null,
    computed_at: new Date().toISOString(),
  }
}

async function fetchPadelapiStats(padelapiId: string): Promise<any | null> {
  if (!PADELAPI_TOKEN) return null
  try {
    const res = await fetch(`https://padelapi.org/api/matches/${padelapiId}/stats`, {
      headers: { Authorization: `Bearer ${PADELAPI_TOKEN}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const matchId = url.searchParams.get('matchId')
  if (!matchId) {
    return Response.json({ error: 'Missing matchId' }, { status: 400 })
  }

  // Fetch match with padelapi_id
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id, status, padelapi_id')
    .eq('id', matchId)
    .maybeSingle()

  if (matchErr) {
    return Response.json({ error: matchErr.message }, { status: 500 })
  }
  if (!match) {
    return Response.json({ error: 'Match not found' }, { status: 404 })
  }

  // Upcoming match — no stats yet
  if (match.status === 'scheduled') {
    return Response.json(
      { stats: null, status: 'upcoming' as StatsStatus },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
    )
  }

  // 1. Check local DB first
  const { data: rows } = await supabase
    .from('match_stats')
    .select('*')
    .eq('match_id', matchId)
    .order('set_number', { ascending: true })

  if (rows && rows.length > 0) {
    const stats = rows.map(({ raw_payload: _raw, ...rest }) => rest)
    return Response.json(
      { stats, status: 'ok' as StatsStatus },
      { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' } },
    )
  }

  // 2. Fetch from padelapi.org and cache
  if (!match.padelapi_id) {
    return Response.json(
      { stats: null, status: 'unavailable' as StatsStatus },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
    )
  }

  const apiStats = await fetchPadelapiStats(match.padelapi_id)
  if (!apiStats || !apiStats.match) {
    return Response.json(
      { stats: null, status: 'unavailable' as StatsStatus },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
    )
  }

  // Map API response to our row format
  const statsRows = []

  // Match aggregate (set_number = 0)
  statsRows.push(mapApiStatsToRow(matchId, 0, apiStats.match))

  // Per-set stats
  let setNum = 1
  while (apiStats[`set_${setNum}`]) {
    statsRows.push(mapApiStatsToRow(matchId, setNum, apiStats[`set_${setNum}`]))
    setNum++
  }

  // Cache in DB (fire-and-forget, don't block response)
  if (statsRows.length > 0) {
    supabase
      .from('match_stats')
      .upsert(statsRows, { onConflict: 'match_id, set_number' })
      .then(({ error }) => {
        if (error) console.error('[match-stats] Cache write failed:', error.message)
      })
  }

  // Return stats (strip raw_payload which we didn't set anyway)
  return Response.json(
    { stats: statsRows, status: 'ok' as StatsStatus },
    { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' } },
  )
}
