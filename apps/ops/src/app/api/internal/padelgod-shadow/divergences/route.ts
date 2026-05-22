// apps/ops/src/app/api/internal/padelgod-shadow/divergences/route.ts
// GET shadow_diff rows filtered by tournament + comparison type.
//
// Auth: Auth.js session — isOperator required (rule 1).
// Supabase: serviceClient() (rule 2).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_TYPES = new Set(['final_state', 'live_latency', 'per_point_sequence'])

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')
  const type = url.searchParams.get('type') ?? 'final_state'
  const limitParam = url.searchParams.get('limit')
  const limit = Math.min(200, Math.max(1, parseInt(limitParam ?? '50', 10) || 50))

  if (!tournamentId) {
    return NextResponse.json({ error: 'tournament_id required' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
