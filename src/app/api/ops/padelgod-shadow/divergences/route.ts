// src/app/api/ops/padelgod-shadow/divergences/route.ts
// GET shadow_diff rows filtered by tournament + comparison type.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const ALLOWED_TYPES = new Set(['final_state', 'live_latency', 'per_point_sequence'])

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')
  const type = url.searchParams.get('type') ?? 'final_state'
  const limitParam = url.searchParams.get('limit')
  const limit = Math.min(200, Math.max(1, parseInt(limitParam ?? '50', 10) || 50))

  if (!tournamentId) {
    return Response.json({ error: 'tournament_id required' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(type)) {
    return Response.json(
      { error: "type must be 'final_state' | 'live_latency' | 'per_point_sequence'" },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('comparison_type', type)
    .order('computed_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[Shadow Divergences] query failed:', error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data ?? [])
}
