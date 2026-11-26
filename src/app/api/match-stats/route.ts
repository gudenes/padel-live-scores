// src/app/api/match-stats/route.ts
//
// Public GET endpoint for the Stats tab on match detail.
// Returns { stats: MatchStatsRow[] | null, status }.
//
// Stats source: padelgod's `match-stats-fetcher` worker writes rows to
// `match_stats` from the Crionet widget (`source='crionet_widget'`). This
// route is read-only against that table — it never fetches from any
// external API. If a match has no row yet (worker hasn't run for it),
// the response is `status='unavailable'` and the UI falls back to
// breaks-only or the empty state.
//
// Status values:
//   'ok'           — stats present
//   'upcoming'     — match hasn't started yet
//   'unavailable'  — no stats available for this match (not synced yet)
//
// 2026-05-11 — padelapi.org on-demand fallback removed. Stats are
// Crionet-only now; see `padelgod/src/workers/match-stats-fetcher.ts`.

import { createClient } from '@supabase/supabase-js'
import { isMatchWebtugaSourced } from '@/lib/webtuga-source'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

type StatsStatus = 'ok' | 'unavailable' | 'upcoming'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const matchId = url.searchParams.get('matchId')
  if (!matchId) {
    return Response.json({ error: 'Missing matchId' }, { status: 400 })
  }

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id, status')
    .eq('id', matchId)
    .maybeSingle()

  if (matchErr) {
    return Response.json({ error: matchErr.message }, { status: 500 })
  }
  if (!match) {
    return Response.json({ error: 'Match not found' }, { status: 404 })
  }

  const webtugaSourced = await isMatchWebtugaSourced(supabase, matchId)

  if (match.status === 'scheduled') {
    return Response.json(
      { stats: null, status: 'upcoming' as StatsStatus, webtugaSourced },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
    )
  }

  const { data: rows, error: statsError } = await supabase
    .from('match_stats')
    .select(
      'match_id,source,source_match_id,computed_at,team1_break_points_converted_pct,team2_break_points_converted_pct,set_number,team1_first_serve_won,team1_first_serve_played,team1_second_serve_won,team1_second_serve_played,team1_service_games,team2_first_serve_won,team2_first_serve_played,team2_second_serve_won,team2_second_serve_played,team2_service_games,team1_first_return_won,team1_first_return_played,team1_second_return_won,team1_second_return_played,team1_return_games,team2_first_return_won,team2_first_return_played,team2_second_return_won,team2_second_return_played,team2_return_games,team1_total_points_won,team1_total_points_played,team1_serve_points_won,team1_serve_points_played,team1_return_points_won,team1_return_points_played,team1_longest_streak,team2_total_points_won,team2_total_points_played,team2_serve_points_won,team2_serve_points_played,team2_return_points_won,team2_return_points_played,team2_longest_streak',
    )
    .eq('match_id', matchId)
    .order('set_number', { ascending: true })

  if (statsError) return Response.json({ error: 'Failed to load match stats' }, { status: 500 })

  if (rows && rows.length > 0) {
    const stats = rows
    return Response.json(
      { stats, status: 'ok' as StatsStatus, webtugaSourced },
      { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' } },
    )
  }

  return Response.json(
    { stats: null, status: 'unavailable' as StatsStatus, webtugaSourced },
    { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
  )
}
