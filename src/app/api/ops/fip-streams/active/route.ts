// src/app/api/ops/fip-streams/active/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'

export async function GET() {
  const cookie = (await cookies()).get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (cookie !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'token_mismatch' }, { status: 401 })
  }

  const supabase = createServerClient()
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
