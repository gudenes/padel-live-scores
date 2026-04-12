// src/app/api/ops/schedule-review/changes/route.ts
// Returns recent OOP changes from ops_events (last 48h).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  if (token !== cronSecret) return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  return null
}

export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const since = new Date()
  since.setHours(since.getHours() - 48)

  const { data, error } = await supabase
    .from('ops_events')
    .select('meta, created_at')
    .eq('source', 'oop-monitor')
    .eq('status', 'ok')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return Response.json({ changes: [], error: error.message })
  }

  const changes = (data || []).map(row => ({
    ...(row.meta as Record<string, unknown>),
    created_at: row.created_at,
  }))

  return Response.json({ changes })
}
