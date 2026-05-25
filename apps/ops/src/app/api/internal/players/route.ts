// apps/ops/src/app/api/internal/players/route.ts
// Player detail + edit API for ops dashboard.
// Auth: Auth.js session with isOperator check.
//
// Equipment is intentionally NOT selected here — the legacy `players.equipment`
// jsonb column is deprecated. Source of truth is the `player_equipment` junction;
// drawer's Equipment tab fetches it via /api/internal/player-equipment.
// Spec: docs/superpowers/specs/2026-05-22-players-equipment-full-profile-design.md

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { pgPool } from '@/lib/db'
import { normalizeName } from '@/lib/normalize-name'

// -- GET: Fetch single player with match count ───────────────────
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return Response.json({ error: 'Missing required param: id' }, { status: 400 })
  }

  const supabase = serviceClient()

  const { data: player, error } = await supabase
    .from('players')
    .select('id, name, display_name, country, category, ranking, points, ranking_move, race_ranking, race_points, race_move, external_id, fip_id, avatar_url, profile_url, side, height, birthdate, birthplace, hand, titles, finals, semifinals, win_rate, total_matches, created_at, updated_at')
    .eq('id', id)
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (!player) {
    return Response.json({ error: 'Player not found' }, { status: 404 })
  }

  // Count matches referencing this player across all 4 FK columns
  const { count, error: countError } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .or(`pair1_player1_id.eq.${id},pair1_player2_id.eq.${id},pair2_player1_id.eq.${id},pair2_player2_id.eq.${id}`)

  if (countError) {
    console.error('[Players] Failed to count matches:', countError.message)
  }

  return Response.json({ player, matchCount: count ?? 0 })
}

// -- POST: Create a new player (operator action from ResolvePartnerModal) ──
// Inserts a public.players row. If `sourceName` is provided, also upserts
// an alias in entity_external_ids so the parsed PDF name resolves instantly
// on future fetcher runs.
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: { name?: string; country?: string; category?: string; sourceName?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const country = typeof body.country === 'string' ? body.country.trim() || null : null
  const category = body.category === 'men' || body.category === 'women' ? body.category : null
  const sourceName = typeof body.sourceName === 'string' ? body.sourceName.trim() || null : null

  if (!name) return NextResponse.json({ error: 'missing required field: name' }, { status: 400 })
  if (!category) return NextResponse.json({ error: 'category must be men or women' }, { status: 400 })

  const pool = pgPool()
  const insertRes = await pool.query(
    `insert into public.players (name, country, category, normalized_name, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())
     returning id`,
    [name, country, category, normalizeName(name)],
  )
  const playerId = insertRes.rows[0]?.id as string | undefined
  if (!playerId) {
    return NextResponse.json({ error: 'create failed' }, { status: 500 })
  }

  let aliasWritten = false
  if (sourceName) {
    try {
      await pool.query(
        `insert into public.entity_external_ids
           (entity_type, entity_id, source, external_id, metadata, last_seen_at)
         values ('player', $1, 'alias', $2, jsonb_build_object('normalized', $3::text), now())
         on conflict (source, entity_type, external_id) do update
           set entity_id = excluded.entity_id,
               metadata = excluded.metadata,
               last_seen_at = excluded.last_seen_at`,
        [playerId, sourceName, normalizeName(sourceName)],
      )
      aliasWritten = true
    } catch (err) {
      console.warn(`[ops/players POST] alias upsert failed for ${playerId} (sourceName="${sourceName}")`, err)
    }
  }

  return NextResponse.json({ id: playerId, ok: true, aliasWritten })
}

// -- PATCH: Update player fields ─────────────────────────────────
export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { id, updates } = body as { id: string; updates: Record<string, unknown> }

  if (!id || !updates || Object.keys(updates).length === 0) {
    return Response.json({ error: 'Missing required fields: id, updates (non-empty)' }, { status: 400 })
  }

  const supabase = serviceClient()

  const { error } = await supabase
    .from('players')
    .update(updates)
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
