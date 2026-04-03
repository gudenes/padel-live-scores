// src/app/api/ops/simulator/create-tournament/route.ts
// Creates a simulated tournament with auto-picked players paired into matches.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== process.env.CRON_SECRET) {
    console.error('[Ops Auth] Token mismatch', { hasToken: !!token, tokenLength: token?.length })
    return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  }
  return null
}

interface CreateTournamentRequest {
  name: string
  category: 'men' | 'women'
  matchCount: number
  round?: string
  date?: string  // ISO date string e.g. "2026-04-03"
  playerIds?: string[]  // optional — if omitted, auto-pick from DB
}

export async function POST(request: Request) {
  const authError = await checkOpsAuth()
  if (authError) return authError

  let body: CreateTournamentRequest
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, category, matchCount, round, date } = body

  if (!name || !category || !matchCount) {
    return Response.json(
      { error: 'Missing required fields: name, category, matchCount' },
      { status: 400 }
    )
  }

  if (matchCount < 1 || matchCount > 64) {
    return Response.json({ error: 'matchCount must be between 1 and 64' }, { status: 400 })
  }

  // Auto-pick players if not provided
  const totalPlayersNeeded = matchCount * 4
  let playerIds = body.playerIds ?? []

  if (playerIds.length === 0) {
    // Fetch top-ranked players for this category, shuffled
    const { data: players, error: pErr } = await supabase
      .from('players')
      .select('id')
      .eq('category', category)
      .not('name', 'is', null)
      .order('ranking', { ascending: true, nullsFirst: false })
      .limit(totalPlayersNeeded * 2) // fetch extra to have variety

    if (pErr || !players || players.length === 0) {
      console.error('[simulator/create-tournament] auto-pick players error', pErr)
      return Response.json({ error: 'No players found for category: ' + category }, { status: 400 })
    }

    // Shuffle and take what we need
    const shuffled = players.sort(() => Math.random() - 0.5)
    playerIds = shuffled.slice(0, totalPlayersNeeded).map(p => p.id)

    // If not enough unique players, cycle through what we have
    if (playerIds.length < totalPlayersNeeded) {
      const original = [...playerIds]
      while (playerIds.length < totalPlayersNeeded) {
        playerIds.push(original[playerIds.length % original.length])
      }
    }
  } else {
    // Cycle provided playerIds if fewer than needed
    const original = [...playerIds]
    while (playerIds.length < totalPlayersNeeded) {
      playerIds.push(original[playerIds.length % original.length])
    }
  }

  // Shuffle the final list so pairs are random
  playerIds.sort(() => Math.random() - 0.5)

  // Insert tournament
  const startsAt = date ? new Date(date + 'T10:00:00Z') : new Date()
  const endsAt = new Date(startsAt.getTime() + 5 * 24 * 60 * 60 * 1000)

  const { data: tournament, error: tournError } = await supabase
    .from('tournaments')
    .insert({
      external_id: 'sim_' + Date.now(),
      name,
      source: 'simulated',
      level: 'simulated',
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .select()
    .single()

  if (tournError || !tournament) {
    console.error('[simulator/create-tournament] insert tournament error', tournError)
    return Response.json({ error: 'Failed to create tournament' }, { status: 500 })
  }

  // Build match rows — each match gets 4 consecutive players (2 pairs)
  const matchRows = []
  for (let i = 0; i < matchCount; i++) {
    const base = i * 4
    matchRows.push({
      external_id: `sim_${tournament.id}_match_${i + 1}`,
      tournament_id: tournament.id,
      status: 'scheduled',
      category,
      round: round ?? 'R32',
      pair1_player1_id: playerIds[base],
      pair1_player2_id: playerIds[base + 1],
      pair2_player1_id: playerIds[base + 2],
      pair2_player2_id: playerIds[base + 3],
    })
  }

  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .insert(matchRows)
    .select(`
      id, external_id, status, round,
      pair1_player1:pair1_player1_id(id, name, country),
      pair1_player2:pair1_player2_id(id, name, country),
      pair2_player1:pair2_player1_id(id, name, country),
      pair2_player2:pair2_player2_id(id, name, country)
    `)

  if (matchError) {
    console.error('[simulator/create-tournament] insert matches error', matchError)
    await supabase.from('tournaments').delete().eq('id', tournament.id)
    return Response.json({ error: 'Failed to create matches' }, { status: 500 })
  }

  return Response.json({ tournament, matches: matches ?? [] })
}
