// src/app/api/ops/seed-draw/route.ts
// Receives confirmed draw entries, resolves players, stores in tournament_draws.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { PlayerResolver } from '@/lib/player-resolver'
import { toIso2 } from '@/lib/fip-scraper'

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

interface SeedDrawEntry {
  drawPosition: number
  round: string | null         // R32, R16, QF, SF, F — for visual bracket
  player1Name: string
  player1Country: string | null
  player2Name: string
  player2Country: string | null
  seed: number | null
  marker: 'Q' | 'WC' | 'LL' | null
  teamPoints: number | null
}

interface SeedDrawRequest {
  tournamentId: string
  category: 'men' | 'women'
  entries: SeedDrawEntry[]
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body: SeedDrawRequest = await request.json()

  if (!body.tournamentId || !body.category || !body.entries?.length) {
    return Response.json({ error: 'Missing required fields: tournamentId, category, entries' }, { status: 400 })
  }

  // Verify tournament exists
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name')
    .eq('id', body.tournamentId)
    .single()

  if (!tournament) {
    return Response.json({ error: 'Tournament not found' }, { status: 404 })
  }

  const resolver = new PlayerResolver(supabase)
  await resolver.load()

  let resolved = 0
  let created = 0
  const errors: string[] = []

  for (const entry of body.entries) {
    try {
      // Resolve player 1
      const p1Result = await resolver.resolve({
        name: entry.player1Name,
        country: toIso2(entry.player1Country),
        category: body.category,
        points: entry.teamPoints ?? undefined,
      })
      if (p1Result.action === 'created') created++
      else resolved++

      // Resolve player 2
      const p2Result = await resolver.resolve({
        name: entry.player2Name,
        country: toIso2(entry.player2Country),
        category: body.category,
        points: entry.teamPoints ?? undefined,
      })
      if (p2Result.action === 'created') created++
      else resolved++

      // Upsert into tournament_draws
      await supabase
        .from('tournament_draws')
        .upsert({
          tournament_id: body.tournamentId,
          category: body.category,
          draw_position: entry.drawPosition,
          seed: entry.seed,
          marker: entry.marker,
          player1_name: entry.player1Name,
          player1_country: toIso2(entry.player1Country),
          player1_id: p1Result.playerId,
          player2_name: entry.player2Name,
          player2_country: toIso2(entry.player2Country),
          player2_id: p2Result.playerId,
          team_points: entry.teamPoints,
          round: entry.round ?? null,
        }, { onConflict: 'tournament_id, category, draw_position' })

    } catch (e) {
      errors.push(`Slot ${entry.drawPosition}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Log to ops_events
  await supabase.from('ops_events').insert({
    source: 'draw-seed',
    status: errors.length > 0 ? 'partial' : 'ok',
    started_at: new Date().toISOString(),
    duration_ms: 0,
    meta: {
      tournament_id: body.tournamentId,
      tournament_name: tournament.name,
      category: body.category,
      slots_total: body.entries.length,
      players_resolved: resolved,
      players_created: created,
      errors: errors.length,
    },
    error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
  })

  return Response.json({
    slots: body.entries.length,
    resolved,
    created,
    errors,
  })
}
