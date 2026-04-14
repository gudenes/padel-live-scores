// src/app/api/ops/search-players/route.ts
// Search players by name for the ops dashboard.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Auth ────────────────────────────────────────────────────────
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

// ── GET: Search players by name ────────────────────────────────
export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const q = url.searchParams.get('q')
  const category = url.searchParams.get('category')

  if (!q || !q.trim()) {
    return Response.json({ error: 'Missing required query parameter: q' }, { status: 400 })
  }

  let query = supabase
    .from('players')
    .select('id, name, display_name, country, ranking, points, category, avatar_url')
    .ilike('name', `%${q}%`)

  if (category === 'men' || category === 'women') {
    query = query.eq('category', category)
  }

  const { data, error } = await query
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(50)

  if (error) {
    console.error('[Search Players] Query failed:', error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Fetch current equipment for all returned players in one query
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

  const players = (data ?? []).map(p => ({
    ...p,
    equipment: equipmentMap[p.id] ?? null,
  }))

  return Response.json({ players })
}
