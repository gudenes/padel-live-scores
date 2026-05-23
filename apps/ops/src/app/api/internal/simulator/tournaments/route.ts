// apps/ops/src/app/api/internal/simulator/tournaments/route.ts
// Lists simulated tournaments, fetches matches for a tournament, or returns players for picker.
// Auth: Auth.js session with isOperator check.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { searchParams } = new URL(request.url)
  const playersCategory = searchParams.get('players')
  const tournamentId = searchParams.get('id')

  // ?players=men or ?players=women → player picker
  if (playersCategory) {
    const { data: players, error } = await supabase
      .from('players')
      .select('id, name, country, ranking')
      .eq('category', playersCategory)
      .not('name', 'is', null)
      .order('ranking', { ascending: true, nullsFirst: false })
      .limit(200)

    if (error) {
      console.error('[simulator/tournaments] players query error', error)
      return Response.json({ error: 'Failed to fetch players' }, { status: 500 })
    }

    return Response.json({ players: players ?? [] })
  }

  // ?id=<uuid> → matches for that tournament
  if (tournamentId) {
    const { data: matches, error } = await supabase
      .from('matches')
      .select(`
        id, external_id, status, round, scheduled_at,
        pair1_player1:pair1_player1_id(id, name, country),
        pair1_player2:pair1_player2_id(id, name, country),
        pair2_player1:pair2_player1_id(id, name, country),
        pair2_player2:pair2_player2_id(id, name, country),
        sets(set_number, set_score, pair1_games, pair2_games)
      `)
      .eq('tournament_id', tournamentId)
      .order('created_at')

    if (error) {
      console.error('[simulator/tournaments] matches query error', error)
      return Response.json({ error: 'Failed to fetch matches' }, { status: 500 })
    }

    return Response.json({ matches: matches ?? [] })
  }

  // Default: list all simulated tournaments with match status counts
  const { data: tournaments, error: tournError } = await supabase
    .from('tournaments')
    .select('id, name, level, created_at')
    .eq('source', 'simulated')
    .order('created_at', { ascending: false })

  if (tournError) {
    console.error('[simulator/tournaments] tournaments query error', tournError)
    return Response.json({ error: 'Failed to fetch tournaments' }, { status: 500 })
  }

  if (!tournaments || tournaments.length === 0) {
    return Response.json({ tournaments: [] })
  }

  // For each tournament, count matches by status
  const tournamentIds = tournaments.map((t) => t.id)
  const { data: matchCounts, error: matchError } = await supabase
    .from('matches')
    .select('tournament_id, status')
    .in('tournament_id', tournamentIds)

  if (matchError) {
    console.error('[simulator/tournaments] match counts query error', matchError)
    return Response.json({ error: 'Failed to fetch match counts' }, { status: 500 })
  }

  const countsByTournament: Record<string, Record<string, number>> = {}
  for (const row of matchCounts ?? []) {
    const tid = row.tournament_id as string
    const status = row.status as string
    if (!countsByTournament[tid]) countsByTournament[tid] = {}
    countsByTournament[tid][status] = (countsByTournament[tid][status] ?? 0) + 1
  }

  const enriched = tournaments.map((t) => ({
    ...t,
    matchCounts: countsByTournament[t.id] ?? {},
  }))

  return Response.json({ tournaments: enriched })
}

// PATCH — update match scheduled_at
export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  let body: { matchId: string; scheduled_at: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.matchId || !body.scheduled_at) {
    return Response.json({ error: 'Missing matchId or scheduled_at' }, { status: 400 })
  }

  const { error } = await supabase
    .from('matches')
    .update({ scheduled_at: body.scheduled_at })
    .eq('id', body.matchId)

  if (error) {
    console.error('[simulator/tournaments] PATCH error', error)
    return Response.json({ error: 'Failed to update match' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
