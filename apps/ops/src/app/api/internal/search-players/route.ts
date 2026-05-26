// apps/ops/src/app/api/internal/search-players/route.ts
// Search players by name for the ops dashboard.
// Auth: Auth.js session with isOperator check.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

// ── GET: Search/browse players with pagination + filters ───────
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() || null
  const category = url.searchParams.get('category')
  const filter = url.searchParams.get('filter')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') ?? '25', 10)))
  const from = (page - 1) * perPage
  const to = from + perPage - 1

  let query = supabase
    .from('players')
    .select('id, name, display_name, country, ranking, points, category, avatar_url, fip_id', { count: 'exact' })

  if (q) {
    query = query.ilike('name', `%${q}%`)
  }

  if (category === 'men' || category === 'women') {
    query = query.eq('category', category)
  }

  // Data quality filters (DB-side where possible)
  if (filter === 'missing_avatar') {
    query = query.is('avatar_url', null)
  } else if (filter === 'missing_ranking') {
    query = query.is('ranking', null)
  }
  // missing_equipment is handled post-fetch after equipment lookup

  const { data, error, count } = await query
    .order('ranking', { ascending: true, nullsFirst: false })
    .range(from, to)

  if (error) {
    console.error('[Search Players] Query failed:', error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Equipment is derived from the player_equipment junction (source of truth).
  // The legacy `players.equipment` text/jsonb column is deprecated — do not read it here.
  // Junction is canonical per spec 2026-05-22-players-equipment-full-profile-design.md.
  const playerIds = (data ?? []).map(p => p.id)
  let equipmentMap: Record<string, { brand: string; model: string; year: number | null }> = {}

  if (playerIds.length > 0) {
    const { data: eqData } = await supabase
      .from('player_equipment')
      .select('player_id, racket:padel_rackets(model, year, brand:padel_brands(name))')
      .in('player_id', playerIds)
      .is('ended_at', null)

    for (const eq of eqData ?? []) {
      const racket = eq.racket as any
      if (racket) {
        equipmentMap[eq.player_id] = {
          brand: racket.brand?.name ?? '',
          model: racket.model ?? '',
          year: racket.year ?? null,
        }
      }
    }
  }

  let players = (data ?? []).map(p => ({
    ...p,
    equipment: equipmentMap[p.id] ?? null,
  }))

  // Post-filter for missing_equipment (can't do this at DB level without a join)
  if (filter === 'missing_equipment') {
    players = players.filter(p => !p.equipment)
  }

  return Response.json({
    players,
    total: count ?? 0,
    page,
    per_page: perPage,
  })
}
