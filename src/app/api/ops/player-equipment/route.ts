// src/app/api/ops/player-equipment/route.ts
// Player equipment assignment API for ops dashboard.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// -- Auth ────────────────────────────────────────────────────────
async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== cronSecret) {
    console.error('[Ops Auth] Token mismatch', { hasToken: !!token, tokenLength: token?.length })
    return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  }
  return null
}

// -- GET: Get equipment history for a player ─────────────────────
export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const playerId = url.searchParams.get('player_id')

  if (!playerId) {
    return Response.json({ error: 'Missing required param: player_id' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('player_equipment')
    .select('*, racket:padel_rackets(*, brand:padel_brands(id, name, logo_url))')
    .eq('player_id', playerId)
    .order('started_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ equipment: data ?? [] })
}

// -- POST: Assign racket to player ───────────────────────────────
export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json() as { player_id?: string; racket_id?: string; started_at?: string }
  const { player_id, racket_id, started_at } = body

  if (!player_id || !racket_id) {
    return Response.json({ error: 'Missing required fields: player_id, racket_id' }, { status: 400 })
  }

  // End any current equipment assignment
  const { error: endError } = await supabase
    .from('player_equipment')
    .update({ ended_at: new Date().toISOString().split('T')[0] })
    .eq('player_id', player_id)
    .is('ended_at', null)

  if (endError) {
    return Response.json({ error: endError.message }, { status: 500 })
  }

  // Insert new assignment
  const { data: assignment, error: insertError } = await supabase
    .from('player_equipment')
    .insert({
      player_id,
      racket_id,
      started_at: started_at ?? new Date().toISOString().split('T')[0],
      ended_at: null,
    })
    .select('*, racket:padel_rackets(*, brand:padel_brands(id, name, logo_url))')
    .single()

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 })
  }

  return Response.json({ assignment })
}

// -- PATCH: End an equipment assignment ──────────────────────────
export async function PATCH(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json() as { id?: string; ended_at?: string }
  const { id, ended_at } = body

  if (!id || !ended_at) {
    return Response.json({ error: 'Missing required fields: id, ended_at' }, { status: 400 })
  }

  const { data: assignment, error } = await supabase
    .from('player_equipment')
    .update({ ended_at })
    .eq('id', id)
    .select('*, racket:padel_rackets(*, brand:padel_brands(id, name, logo_url))')
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ assignment })
}
