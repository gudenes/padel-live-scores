// src/app/api/ops/fip-streams/unresolved/route.ts
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
  const { data, error } = await supabase
    .from('fip_streams_unresolved')
    .select('*')
    .is('resolved_at', null)
    .order('first_seen_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
