// src/app/api/ops/simulator/create-tournament/route.ts
// Creates a simulated tournament with N matches assigned from a pool of player IDs.
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
  playerIds: string[]
  round?: string
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

  const { name, category, matchCount, playerIds, round } = body

  if (!name || !category || !matchCount || !playerIds || playerIds.length === 0) {
    return Response.json(
      { error: 'Missing required fields: name, category, matchCount, playerIds' },
      { status: 400 }
    )
  }

  if (matchCount < 1 || matchCount > 64) {
    return Response.json({ error: 'matchCount must be between 1 and 64' }, { status: 400 })
  }

  // Insert tournament
  const now = new Date()
  const endsAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000) // +5 days

  const { data: tournament, error: tournError } = await supabase
    .from('tournaments')
    .insert({
      external_id: 'sim_' + Date.now(),
      name,
      category,
      source: 'simulated',
      level: 'simulated',
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .select()
    .single()

  if (tournError || !tournament) {
    console.error('[simulator/create-tournament] insert tournament error', tournError)
    return Response.json({ error: 'Failed to create tournament' }, { status: 500 })
  }

  // Build match rows, cycling playerIds if fewer than matchCount * 4
  const totalPlayersNeeded = matchCount * 4
  const cycledPlayerIds: string[] = []
  for (let i = 0; i < totalPlayersNeeded; i++) {
    cycledPlayerIds.push(playerIds[i % playerIds.length])
  }

  const matchRows = []
  for (let i = 0; i < matchCount; i++) {
    const base = i * 4
    matchRows.push({
      external_id: `sim_${tournament.id}_match_${i + 1}`,
      tournament_id: tournament.id,
      status: 'scheduled',
      category,
      round: round ?? 'R32',
      pair1_player1_id: cycledPlayerIds[base],
      pair1_player2_id: cycledPlayerIds[base + 1],
      pair2_player1_id: cycledPlayerIds[base + 2],
      pair2_player2_id: cycledPlayerIds[base + 3],
    })
  }

  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .insert(matchRows)
    .select('id, external_id, status, round, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')

  if (matchError) {
    console.error('[simulator/create-tournament] insert matches error', matchError)
    // Roll back tournament
    await supabase.from('tournaments').delete().eq('id', tournament.id)
    return Response.json({ error: 'Failed to create matches' }, { status: 500 })
  }

  return Response.json({ tournament, matches: matches ?? [] })
}
