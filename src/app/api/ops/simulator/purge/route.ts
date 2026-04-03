// src/app/api/ops/simulator/purge/route.ts
// Deletes all simulated tournaments (and cascades to matches).
// Requires confirm: "PURGE" in the request body as a safety guard.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (token !== process.env.CRON_SECRET) {
    console.error('[Ops Auth] Token mismatch', { hasToken: !!token, tokenLength: token?.length })
    return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  }
  return null
}

export async function POST(request: Request) {
  const authError = await checkOpsAuth()
  if (authError) return authError

  let body: { confirm?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.confirm !== 'PURGE') {
    return Response.json(
      { error: 'Must send { confirm: "PURGE" } to proceed' },
      { status: 400 }
    )
  }

  // Count tournaments and matches before deleting
  const { data: simulatedTournaments, error: countTournError } = await supabase
    .from('tournaments')
    .select('id')
    .eq('source', 'simulated')

  if (countTournError) {
    console.error('[simulator/purge] count tournaments error', countTournError)
    return Response.json({ error: 'Failed to count tournaments' }, { status: 500 })
  }

  const tournamentIds = (simulatedTournaments ?? []).map((t) => t.id)
  const tournamentCount = tournamentIds.length

  if (tournamentCount === 0) {
    return Response.json({ deleted: { tournaments: 0, matches: 0 } })
  }

  const { count: matchCount, error: countMatchError } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('tournament_id', tournamentIds)

  if (countMatchError) {
    console.error('[simulator/purge] count matches error', countMatchError)
    return Response.json({ error: 'Failed to count matches' }, { status: 500 })
  }

  // Delete tournaments — matches should cascade if FK has ON DELETE CASCADE
  const { error: deleteError } = await supabase
    .from('tournaments')
    .delete()
    .eq('source', 'simulated')

  if (deleteError) {
    console.error('[simulator/purge] delete error', deleteError)
    return Response.json({ error: 'Failed to purge simulated tournaments' }, { status: 500 })
  }

  return Response.json({
    deleted: {
      tournaments: tournamentCount,
      matches: matchCount ?? 0,
    },
  })
}
