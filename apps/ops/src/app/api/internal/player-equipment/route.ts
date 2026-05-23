// apps/ops/src/app/api/internal/player-equipment/route.ts
// Player equipment assignment API for ops dashboard.
// Auth: Auth.js session with isOperator flag.
// Ported from src/app/api/ops/player-equipment/route.ts (Plan 3a hotfix).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

// -- GET: Get equipment history for a player ─────────────────────
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const playerId = url.searchParams.get('player_id')

  if (!playerId) {
    return Response.json({ error: 'Missing required param: player_id' }, { status: 400 })
  }

  const supabase = serviceClient()
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
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    player_id?: string
    racket_id?: string
    started_at?: string
    notes?: string
  }
  const { player_id, racket_id, started_at, notes } = body

  if (!player_id || !racket_id) {
    return Response.json({ error: 'Missing required fields: player_id, racket_id' }, { status: 400 })
  }

  const supabase = serviceClient()
  const effectiveStart = started_at ?? new Date().toISOString().split('T')[0]

  // End any current equipment assignment on the same day the new one starts
  // (same-day auto-end per the spec — keeps the history contiguous without
  // a one-day gap or overlap).
  const { error: endError } = await supabase
    .from('player_equipment')
    .update({ ended_at: effectiveStart })
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
      started_at: effectiveStart,
      ended_at: null,
      notes: notes ?? null,
    })
    .select('*, racket:padel_rackets(*, brand:padel_brands(id, name, logo_url))')
    .single()

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 })
  }

  return Response.json({ assignment })
}

// -- PUT: Bulk assign equipment to multiple players ──────────────
export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { player_ids?: string[]; racket_id?: string }
  const { player_ids, racket_id } = body

  if (!player_ids?.length || !racket_id) {
    return Response.json({ error: 'Missing required fields: player_ids, racket_id' }, { status: 400 })
  }

  const supabase = serviceClient()
  const today = new Date().toISOString().split('T')[0]
  let assigned = 0

  for (const playerId of player_ids) {
    // End current assignment if exists
    await supabase
      .from('player_equipment')
      .update({ ended_at: today })
      .eq('player_id', playerId)
      .is('ended_at', null)

    // Create new assignment
    const { error } = await supabase
      .from('player_equipment')
      .insert({ player_id: playerId, racket_id, started_at: today })

    if (!error) assigned++
  }

  return Response.json({ assigned, total: player_ids.length })
}

// -- PATCH: End an equipment assignment ──────────────────────────
export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { id?: string; ended_at?: string }
  const { id, ended_at } = body

  if (!id || !ended_at) {
    return Response.json({ error: 'Missing required fields: id, ended_at' }, { status: 400 })
  }

  const supabase = serviceClient()
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
