// src/app/api/ops/tournament-draws/route.ts
// CRUD for tournament_draws table.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// -- GET: List draws for a tournament + category ─────────────────
export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')
  const category = url.searchParams.get('category')

  if (!tournamentId || !category) {
    return Response.json({ error: 'Missing required params: tournament_id, category' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tournament_draws')
    .select('id, tournament_id, category, draw_position, seed, marker, player1_name, player1_country, player1_id, player2_name, player2_country, player2_id, team_points, created_at')
    .eq('tournament_id', tournamentId)
    .eq('category', category)
    .order('draw_position', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ draws: data ?? [] })
}

// -- PATCH: Update existing draw entries ─────────────────────────
export async function PATCH(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json()
  const { updates } = body as {
    updates: {
      id: string
      seed?: number | null
      marker?: string | null
      player1_name?: string
      player1_id?: string | null
      player2_name?: string
      player2_id?: string | null
      team_points?: number | null
    }[]
  }

  if (!updates?.length) {
    return Response.json({ error: 'Missing updates array' }, { status: 400 })
  }

  let updated = 0
  const errors: string[] = []

  for (const update of updates) {
    const { id, ...fields } = update
    if (!id) {
      errors.push('Missing id in update entry')
      continue
    }

    const { error } = await supabase
      .from('tournament_draws')
      .update(fields)
      .eq('id', id)

    if (error) {
      errors.push(`${id}: ${error.message}`)
    } else {
      updated++
    }
  }

  return Response.json({ updated, errors })
}

// -- POST: Add a new draw entry ──────────────────────────────────
export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json()
  const { tournament_id, category, draw_position, player1_name, player2_name,
    seed, marker, player1_country, player2_country, player1_id, player2_id, team_points } = body

  if (!tournament_id || !category || draw_position == null || !player1_name || !player2_name) {
    return Response.json({ error: 'Missing required fields: tournament_id, category, draw_position, player1_name, player2_name' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tournament_draws')
    .insert({
      tournament_id,
      category,
      draw_position,
      player1_name,
      player2_name,
      seed: seed ?? null,
      marker: marker ?? null,
      player1_country: player1_country ?? null,
      player2_country: player2_country ?? null,
      player1_id: player1_id ?? null,
      player2_id: player2_id ?? null,
      team_points: team_points ?? null,
    })
    .select('id')
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ id: data.id })
}

// -- DELETE: Remove a draw entry ─────────────────────────────────
export async function DELETE(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return Response.json({ error: 'Missing required param: id' }, { status: 400 })
  }

  const { error } = await supabase
    .from('tournament_draws')
    .delete()
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ deleted: true })
}
