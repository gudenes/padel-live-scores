// src/app/api/match-stats/route.ts
//
// Public GET endpoint for the Stats tab on match detail.
// Returns { stats: MatchStatsRow[] | null, status }.
//
// Status values:
//   'upcoming'     — match hasn't started yet
//   'no_mapping'   — no Premier mapping exists (probably FIP/unsupported source)
//   'pending_sync' — mapping exists but stats not yet synced
//   'ok'           — stats present

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

type StatsStatus = 'ok' | 'no_mapping' | 'pending_sync' | 'upcoming'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const matchId = url.searchParams.get('matchId')
  if (!matchId) {
    return Response.json({ error: 'Missing matchId' }, { status: 400 })
  }

  // Fetch match status
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

  // Upcoming match? Short-circuit.
  if (match.status === 'scheduled') {
    return Response.json(
      { stats: null, status: 'upcoming' as StatsStatus },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
    )
  }

  // Does a Premier mapping exist?
  const { data: mapping } = await supabase
    .from('entity_external_ids')
    .select('external_id')
    .eq('entity_type', 'match')
    .eq('entity_id', matchId)
    .eq('source', 'premierpadel')
    .maybeSingle()

  if (!mapping) {
    return Response.json(
      { stats: null, status: 'no_mapping' as StatsStatus },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
    )
  }

  // Fetch the stats rows
  const { data: rows, error } = await supabase
    .from('match_stats')
    .select('*')
    .eq('match_id', matchId)
    .order('set_number', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return Response.json(
      { stats: null, status: 'pending_sync' as StatsStatus },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
    )
  }

  // Strip raw_payload to keep response small
  const stats = rows.map(({ raw_payload: _raw, ...rest }) => rest)

  return Response.json(
    { stats, status: 'ok' as StatsStatus },
    { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
  )
}
