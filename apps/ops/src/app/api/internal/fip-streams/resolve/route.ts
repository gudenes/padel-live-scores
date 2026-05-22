// apps/ops/src/app/api/internal/fip-streams/resolve/route.ts
// POST /api/internal/fip-streams/resolve — manually link an unresolved stream to a
// tournament, inserting into fip_court_streams and marking the queue row resolved.
//
// Ported from src/app/api/ops/fip-streams/resolve/route.ts.
// Auth: next-auth session + isOperator flag (rule 1).
// Supabase: serviceClient() (rule 2).

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    unresolvedId: string
    tournamentId: string
    court: string
    dayDate: string
  }

  const supabase = serviceClient()

  const { data: unresolved, error: fetchErr } = await supabase
    .from('fip_streams_unresolved')
    .select('*')
    .eq('id', body.unresolvedId)
    .maybeSingle()
  if (fetchErr || !unresolved) {
    return NextResponse.json({ error: fetchErr?.message ?? 'not_found' }, { status: 404 })
  }

  const { error: insertErr } = await supabase.from('fip_court_streams').upsert({
    youtube_video_id: unresolved.youtube_video_id,
    tournament_id: body.tournamentId,
    court: body.court.toLowerCase(),
    day_date: body.dayDate,
    title: unresolved.title,
    thumbnail_url: unresolved.thumbnail_url,
    state: unresolved.state ?? 'archived',
    scheduled_start_at: unresolved.scheduled_start_at,
    link_method: 'manual',
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'youtube_video_id' })
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const { error: updateErr } = await supabase
    .from('fip_streams_unresolved')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_tournament_id: body.tournamentId,
      resolved_court: body.court,
      resolved_day_date: body.dayDate,
    })
    .eq('id', body.unresolvedId)
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
