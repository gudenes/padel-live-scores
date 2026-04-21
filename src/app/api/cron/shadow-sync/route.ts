// src/app/api/cron/shadow-sync/route.ts
// Bridges padelgod shadow data → public schema for shadow-enabled tournaments.
//
// Why this exists: padelapi.org's /api/live endpoint is subscription-gated and
// may be silent (402). When it is, padelgod is our only source of live scoring
// for shadow-enabled tournaments. This bridge promotes that data into public.*
// so padelnachos.com renders real-time scores.
//
// What it does, every minute:
//   1. Flip `public.matches.status` → 'live' for matches with
//      padelgod.shadow_match_points in the last 5 min (only when current
//      status is 'scheduled' — never overwrites 'finished'/'live' authored
//      by the /live api pipeline).
//   2. Upsert padelgod.shadow_sets → public.sets with score_source='shadow'.
//      Skips rows whose existing score_source is 'api' or 'live' so the
//      canonical pipeline always wins when it catches up.
//
// Scope is intentionally minimal: sets + status. No games, no points. Those
// stay in the padelgod schema for the shadow UI. If we later want the
// momentum chart / point log on the public match detail, we'd add a step 3.

import { createClient } from '@supabase/supabase-js'
import { logOpsEvent } from '@/lib/ops-logger'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

const ACTIVE_WINDOW_MS = 5 * 60 * 1000

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const result = await logOpsEvent('cron:shadow-sync', async () => {
    const { data: tournaments, error: tErr } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('shadow_enabled', true)
    if (tErr) throw new Error(`tournaments query failed: ${tErr.message}`)
    const tournamentIds = (tournaments ?? []).map(t => t.id as string)
    if (tournamentIds.length === 0) {
      return { tournaments: 0, active_matches: 0, sets_written: 0, status_flips: 0 }
    }

    const sinceIso = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString()
    const { data: activePts, error: ptsErr } = await supabase
      .schema('padelgod')
      .from('shadow_match_points')
      .select('match_id')
      .gt('created_at', sinceIso)
    if (ptsErr) throw new Error(`shadow_match_points query failed: ${ptsErr.message}`)
    const activeMatchIds = [...new Set((activePts ?? []).map((r: { match_id: string }) => r.match_id))]

    if (activeMatchIds.length === 0) {
      return { tournaments: tournamentIds.length, active_matches: 0, sets_written: 0, status_flips: 0 }
    }

    const { data: scopedMatches, error: mErr } = await supabase
      .from('matches')
      .select('id, tournament_id, status')
      .in('id', activeMatchIds)
      .in('tournament_id', tournamentIds)
    if (mErr) throw new Error(`scoped matches query failed: ${mErr.message}`)
    const scopedIds = (scopedMatches ?? []).map(m => m.id as string)
    if (scopedIds.length === 0) {
      return { tournaments: tournamentIds.length, active_matches: 0, sets_written: 0, status_flips: 0 }
    }

    let statusFlips = 0
    for (const m of scopedMatches ?? []) {
      if (m.status !== 'scheduled') continue
      const { error, count } = await supabase
        .from('matches')
        .update({ status: 'live', updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', m.id)
        .eq('status', 'scheduled')
      if (!error && count && count > 0) statusFlips++
    }

    const { data: shadowSets, error: sErr } = await supabase
      .schema('padelgod')
      .from('shadow_sets')
      .select('match_id, set_number, set_score, pair1_games, pair2_games')
      .in('match_id', scopedIds)
    if (sErr) throw new Error(`shadow_sets query failed: ${sErr.message}`)

    const { data: existingSets } = await supabase
      .from('sets')
      .select('match_id, set_number, score_source')
      .in('match_id', scopedIds)
    const existingByKey = new Map<string, string | null>()
    for (const row of existingSets ?? []) {
      existingByKey.set(`${row.match_id}:${row.set_number}`, (row.score_source as string | null) ?? null)
    }

    const maxSetByMatch = new Map<string, number>()
    for (const ss of shadowSets ?? []) {
      const key = ss.match_id as string
      const n = Number(ss.set_number)
      if (n > (maxSetByMatch.get(key) ?? 0)) maxSetByMatch.set(key, n)
    }

    let setsWritten = 0
    for (const ss of shadowSets ?? []) {
      const existingSource = existingByKey.get(`${ss.match_id}:${ss.set_number}`)
      if (existingSource === 'api' || existingSource === 'live') continue

      const isCurrent = Number(ss.set_number) === (maxSetByMatch.get(ss.match_id as string) ?? 0)

      const { error: uErr } = await supabase
        .from('sets')
        .upsert(
          {
            match_id: ss.match_id,
            set_number: ss.set_number,
            set_score: ss.set_score,
            pair1_games: ss.pair1_games,
            pair2_games: ss.pair2_games,
            is_current: isCurrent,
            score_source: 'shadow',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'match_id, set_number' }
        )
      if (!uErr) setsWritten++
    }

    return {
      tournaments: tournamentIds.length,
      active_matches: scopedIds.length,
      sets_written: setsWritten,
      status_flips: statusFlips,
    }
  })

  return Response.json(result)
}
