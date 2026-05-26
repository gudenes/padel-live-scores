// apps/ops/src/app/api/internal/padelgod-shadow/enrollments/route.ts
// GET list of tournaments enrollable / enrolled in Padelgod Shadow Mode.
// Scoped to the ±1 day window around NOW to match the live-poller eligibility window.
// Includes a derived cutover_ready flag computed per enrolled tournament.
//
// Auth: Auth.js session — isOperator required (rule 1).
// Supabase: serviceClient() (rule 2).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

type TournamentRow = {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  categories: string | null
  level: string | null
  live_source: string
  shadow_enabled: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

function isoNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

async function computeCutoverReady(supabase: ReturnType<typeof serviceClient>, tournamentId: string): Promise<boolean> {
  const since48h = isoNow(-2 * DAY_MS)

  // final_state: >=5 rows AND 100% winner+score match
  const { data: finalRows, error: finalErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .select('winner_match, score_match')
    .eq('comparison_type', 'final_state')
    .eq('tournament_id', tournamentId)
  if (finalErr) return false
  const finals = finalRows ?? []
  if (finals.length < 5) return false
  const allFinalMatch = finals.every(
    (r: { winner_match: boolean | null; score_match: boolean | null }) => r.winner_match === true && r.score_match === true
  )
  if (!allFinalMatch) return false

  // per_point_sequence: >=5 rows AND >=95% match
  const { data: ppRows, error: ppErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .select('point_sequence_match')
    .eq('comparison_type', 'per_point_sequence')
    .eq('tournament_id', tournamentId)
  if (ppErr) return false
  const pps = ppRows ?? []
  if (pps.length < 5) return false
  const ppMatchPct = (100 * pps.filter((r: { point_sequence_match: boolean | null }) => r.point_sequence_match === true).length) / pps.length
  if (ppMatchPct < 95) return false

  // latency (48h): median <= 3000ms, OR no rows (neutral)
  const { data: latRows, error: latErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .select('latency_delta_ms')
    .eq('comparison_type', 'live_latency')
    .eq('tournament_id', tournamentId)
    .gte('computed_at', since48h)
  if (latErr) return false
  const latencies = (latRows ?? [])
    .map((r: { latency_delta_ms: number | null }) => r.latency_delta_ms)
    .filter((v): v is number => typeof v === 'number')
    .sort((a: number, b: number) => a - b)
  if (latencies.length > 0) {
    const mid = Math.floor(latencies.length / 2)
    const med =
      latencies.length % 2 === 0
        ? (latencies[mid - 1] + latencies[mid]) / 2
        : latencies[mid]
    if (med > 3000) return false
  }

  // zero scrape_jobs errors for job_type='tournamentlive' in last 48h (global, simplified)
  const { count: errorCount, error: jobErr } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('job_type', 'tournamentlive')
    .eq('status', 'failed')
    .gte('started_at', since48h)
  if (jobErr) return false
  if ((errorCount ?? 0) > 0) return false

  return true
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  // Step 1: all tournaments with an active widget_id_cache entry
  const { data: widgetRows, error: widgetErr } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .select('tournament_id')
    .eq('is_active', true)
  if (widgetErr) {
    console.error('[Shadow Enrollments] widget_id_cache query failed:', widgetErr.message)
    return NextResponse.json({ error: widgetErr.message }, { status: 500 })
  }

  const tournamentIds = Array.from(
    new Set((widgetRows ?? []).map((r: { tournament_id: string }) => r.tournament_id).filter(Boolean))
  ) as string[]

  if (tournamentIds.length === 0) {
    return NextResponse.json([])
  }

  // Step 2: fetch tournament details
  const { data: tRows, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, starts_at, ends_at, categories, level, live_source, shadow_enabled')
    .in('id', tournamentIds)
  if (tErr) {
    console.error('[Shadow Enrollments] tournaments query failed:', tErr.message)
    return NextResponse.json({ error: tErr.message }, { status: 500 })
  }

  // Step 3: filter to ±1d window.
  //   tournament qualifies if ends_at (or starts_at+14d fallback) >= NOW()-1d
  //     AND starts_at (or NOW()-7d fallback) <= NOW()+1d
  const now = Date.now()
  const lowerBound = now - DAY_MS
  const upperBound = now + DAY_MS

  const filtered = (tRows ?? []).filter((t: TournamentRow) => {
    const startsMs = t.starts_at ? Date.parse(t.starts_at) : now - 7 * DAY_MS
    const endsMs = t.ends_at
      ? Date.parse(t.ends_at)
      : (t.starts_at ? Date.parse(t.starts_at) + 14 * DAY_MS : now + 14 * DAY_MS)
    return endsMs >= lowerBound && startsMs <= upperBound
  })

  // Step 4: compute cutover_ready for every enrolled tournament
  const results = await Promise.all(
    filtered.map(async (t: TournamentRow) => {
      const cutoverReady = t.shadow_enabled ? await computeCutoverReady(supabase, t.id) : false
      return {
        tournament_id: t.id,
        name: t.name,
        starts_at: t.starts_at,
        category: t.categories, // map DB column `categories` to plan's `category` field
        level: t.level,
        live_source: t.live_source,
        shadow_enabled: t.shadow_enabled,
        cutover_ready: cutoverReady,
      }
    })
  )

  return NextResponse.json(results)
}
