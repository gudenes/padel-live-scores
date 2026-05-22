// apps/ops/src/app/api/internal/fip-streams/active/route.ts
// GET /api/internal/fip-streams/active — list recently-synced FIP court streams.
//
// Ported from src/app/api/ops/fip-streams/active/route.ts.
// Auth: next-auth session + isOperator flag (rule 1).
// Supabase: serviceClient() (rule 2).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('fip_court_streams')
    .select('*, tournaments:tournament_id(name, level)')
    .gte('last_synced_at', cutoff)
    .order('last_synced_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
