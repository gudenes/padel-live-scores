// apps/ops/src/app/api/internal/simulator/purge/route.ts
// Deletes all simulated tournaments (and cascades to matches).
// Requires confirm: "PURGE" in the request body as a safety guard.
// Auth: Auth.js session with isOperator check.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

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

  // Collect every simulator trace:
  //   - tournaments with source='simulated', level='simulated', or external_id LIKE 'sim_%'
  //   - orphan matches with external_id LIKE 'sim_%' (tournament_id may have been nulled previously)
  const tournamentIds = new Set<string>()

  const { data: bySource, error: sourceErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('source', 'simulated')
  if (sourceErr) {
    console.error('[simulator/purge] query bySource error', sourceErr)
    return Response.json({ error: 'Failed to query tournaments (source)' }, { status: 500 })
  }
  bySource?.forEach(t => tournamentIds.add(t.id))

  const { data: byLevel, error: levelErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('level', 'simulated')
  if (levelErr) {
    console.error('[simulator/purge] query byLevel error', levelErr)
    return Response.json({ error: 'Failed to query tournaments (level)' }, { status: 500 })
  }
  byLevel?.forEach(t => tournamentIds.add(t.id))

  const { data: byExt, error: extErr } = await supabase
    .from('tournaments')
    .select('id')
    .like('external_id', 'sim_%')
  if (extErr) {
    console.error('[simulator/purge] query byExt error', extErr)
    return Response.json({ error: 'Failed to query tournaments (external_id)' }, { status: 500 })
  }
  byExt?.forEach(t => tournamentIds.add(t.id))

  // 1. Delete sim_ matches directly — catches orphans whose parent tournament was
  //    already removed and left the FK nulled instead of cascading.
  const { error: delMatchErr, count: deletedMatchCount } = await supabase
    .from('matches')
    .delete({ count: 'exact' })
    .like('external_id', 'sim_%')
  if (delMatchErr) {
    console.error('[simulator/purge] delete matches error', delMatchErr)
    return Response.json({ error: 'Failed to delete simulator matches' }, { status: 500 })
  }

  // 2. Delete the matching tournaments (cascades any remaining matches)
  let deletedTournCount = 0
  if (tournamentIds.size > 0) {
    const { error: delTournErr, count } = await supabase
      .from('tournaments')
      .delete({ count: 'exact' })
      .in('id', [...tournamentIds])
    if (delTournErr) {
      console.error('[simulator/purge] delete tournaments error', delTournErr)
      return Response.json({ error: 'Failed to delete simulator tournaments' }, { status: 500 })
    }
    deletedTournCount = count ?? 0
  }

  return Response.json({
    deleted: {
      tournaments: deletedTournCount,
      matches: deletedMatchCount ?? 0,
    },
  })
}
