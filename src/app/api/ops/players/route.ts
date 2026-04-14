// src/app/api/ops/players/route.ts
// Player detail + edit API for ops dashboard.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// -- GET: Fetch single player with match count ───────────────────
export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return Response.json({ error: 'Missing required param: id' }, { status: 400 })
  }

  const { data: player, error } = await supabase
    .from('players')
    .select('id, name, display_name, country, category, ranking, points, ranking_move, race_ranking, race_points, race_move, external_id, fip_id, avatar_url, profile_url, side, height, birthdate, birthplace, hand, titles, finals, semifinals, win_rate, total_matches, equipment, created_at, updated_at')
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
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json()
  const { id, updates } = body as { id: string; updates: Record<string, unknown> }

  if (!id || !updates || Object.keys(updates).length === 0) {
    return Response.json({ error: 'Missing required fields: id, updates (non-empty)' }, { status: 400 })
  }

  const { error } = await supabase
    .from('players')
    .update(updates)
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
