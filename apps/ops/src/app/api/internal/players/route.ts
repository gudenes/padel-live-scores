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
import { normalize } from '@/lib/player-resolver'

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

// -- POST: Create a new player from ops UI (e.g. unresolved entry-list partner)
//
// Body: { name, country?, category, sourceName? }
//   - name        : canonical display name to store in players.name
//   - country     : ISO-2 (or 2-3 letter PDF code) — accepted as-is
//   - category    : 'men' | 'women' (required so resolver scopes future lookups)
//   - sourceName  : optional original PDF name to auto-alias for next snapshots
//
// Returns: { id: string, ok: true, aliasWritten: boolean }
//
// This route deliberately does NOT set fip_id or external_id — those land via
// FIP/padelapi sync workers when (or if) the player appears in official rankings.
// Operator-created players carry name + country + category only, and the alias
// bridges PDF text to this row until that happens.
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

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('players')
    .insert({
      name,
      country,
      category,
      normalized_name: normalize(name),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'create failed' }, { status: 500 })
  }

  // Auto-alias the source PDF name so the next snapshot resolves instantly.
  // Best-effort: a failure here doesn't undo the player insert. Surface the
  // partial-success via `aliasWritten: false` so the UI can warn.
  let aliasWritten = false
  if (sourceName) {
    const { error: aliasErr } = await supabase.from('entity_external_ids').upsert(
      {
        entity_type: 'player',
        entity_id: data.id,
        source: 'alias',
        external_id: sourceName,
        metadata: { normalized: normalize(sourceName) },
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'source,entity_type,external_id' },
    )
    if (aliasErr) {
      console.warn(`[ops/players POST] alias upsert failed for ${data.id} (sourceName="${sourceName}"): ${aliasErr.message}`)
    } else {
      aliasWritten = true
    }
  }

  return NextResponse.json({ id: data.id, ok: true, aliasWritten })
}
