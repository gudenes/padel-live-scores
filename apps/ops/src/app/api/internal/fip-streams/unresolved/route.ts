// apps/ops/src/app/api/internal/fip-streams/unresolved/route.ts
// GET /api/internal/fip-streams/unresolved — list unresolved FIP stream queue entries.
//
// Ported from src/app/api/ops/fip-streams/unresolved/route.ts.
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
  const { data, error } = await supabase
    .from('fip_streams_unresolved')
    .select('*')
    .is('resolved_at', null)
    .order('first_seen_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
