// GET /api/player/[id]/next-enrollment
//
// Tier-3 fallback for the player profile "next appointment" strip: the next
// tournament the player is ENROLLED in (padelgod entry lists), used only when
// they have no scheduled match and no matches-derived upcoming tournament.
//
// Cost: queries entry_list_snapshots TOURNAMENT-FIRST (filtered by the small
// set of upcoming tournament ids — the indexed path), never player-first
// (fip_id/name are unindexed → full scan). See the resolver + cost memory.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  resolveNextEnrollment,
  type EntrySnapshotRow,
  type UpcomingTournament,
} from '@/lib/next-enrollment-resolver'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const { data: player, error: playerErr } = await supabase
    .from('players')
    .select('fip_id, normalized_name')
    .eq('id', id)
    .maybeSingle()
  if (playerErr) {
    return NextResponse.json({ error: `players read: ${playerErr.message}` }, { status: 500 })
  }
  const fipId = (player?.fip_id as string | null) ?? null
  const normalizedName = (player?.normalized_name as string | null) ?? null
  if (!fipId && !normalizedName) return jsonNoCache({ enrollment: null })

  const nowIso = new Date().toISOString()
  const { data: tournaments, error: tourErr } = await supabase
    .from('tournaments')
    .select('id, name, level, starts_at, ends_at')
    .gt('ends_at', nowIso)
    .order('starts_at', { ascending: true })
  if (tourErr) {
    return NextResponse.json({ error: `tournaments read: ${tourErr.message}` }, { status: 500 })
  }
  const upcoming = (tournaments ?? []) as UpcomingTournament[]
  if (upcoming.length === 0) return jsonNoCache({ enrollment: null })

  const upcomingIds = upcoming.map((t) => t.id)
  const { data: snaps, error: snapErr } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select('scrape_job_id, tournament_id, category, draw_type, fip_id, name, seed, partner_name, captured_at')
    .in('tournament_id', upcomingIds)
    .order('captured_at', { ascending: false })
  if (snapErr) {
    return NextResponse.json({ error: `entry_list_snapshots read: ${snapErr.message}` }, { status: 500 })
  }

  const enrollment = resolveNextEnrollment({
    player: { fipId, normalizedName },
    snapshots: (snaps ?? []) as EntrySnapshotRow[],
    tournaments: upcoming,
    now: new Date(),
  })

  return jsonNoCache({ enrollment })
}

function jsonNoCache(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
