// src/app/api/ops/fip-streams/resolve/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const cookie = (await cookies()).get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (cookie !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'token_mismatch' }, { status: 401 })
  }

  const body = await req.json() as {
    unresolvedId: string
    tournamentId: string
    court: string
    dayDate: string
  }

  const supabase = createServerClient()

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
