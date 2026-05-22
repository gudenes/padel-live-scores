// apps/ops/src/app/api/internal/padelgod-shadow/health/route.ts
// GET aggregated health metrics for the Padelgod Shadow Mode ops card.
//
// Auth: Auth.js session — isOperator required (rule 1).
// Supabase: serviceClient() (rule 2).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

function isoNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p))
  return sortedAsc[idx]
}

function median(sortedAsc: number[]): number | null {
  if (sortedAsc.length === 0) return null
  const mid = Math.floor(sortedAsc.length / 2)
  if (sortedAsc.length % 2 === 0) {
    return Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2)
  }
  return sortedAsc[mid]
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const since24h = isoNow(-24 * 60 * 60 * 1000)
  const since7d = isoNow(-7 * 24 * 60 * 60 * 1000)

  // enrolledCount
  const { count: enrolledCount, error: enrollErr } = await supabase
    .from('tournaments')
    .select('id', { count: 'exact', head: true })
    .eq('shadow_enabled', true)
  if (enrollErr) {
    console.error('[Shadow Health] enrolledCount query failed:', enrollErr.message)
    return NextResponse.json({ error: enrollErr.message }, { status: 500 })
  }

  // livePollSuccessPct — scrape_jobs in padelgod schema
  const { data: pollJobs, error: pollErr } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('status')
    .eq('job_type', 'tournamentlive')
    .gte('started_at', since24h)
  if (pollErr) {
    console.error('[Shadow Health] scrape_jobs query failed:', pollErr.message)
    return NextResponse.json({ error: pollErr.message }, { status: 500 })
  }
  const pollRows = pollJobs ?? []
  const livePollSuccessPct =
    pollRows.length === 0
      ? null
      : Math.round(
          (100 * pollRows.filter((r: { status: string }) => r.status === 'success').length) / pollRows.length
        )

  // unresolvedCount
  const { count: unresolvedCount, error: unresErr } = await supabase
    .schema('padelgod')
    .from('unresolved_players')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (unresErr) {
    console.error('[Shadow Health] unresolved_players query failed:', unresErr.message)
    return NextResponse.json({ error: unresErr.message }, { status: 500 })
  }

  // finalStateMatchPct — shadow_diff 7d
  const { data: finalRows, error: finalErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .select('winner_match, score_match')
    .eq('comparison_type', 'final_state')
    .gte('computed_at', since7d)
  if (finalErr) {
    console.error('[Shadow Health] shadow_diff final query failed:', finalErr.message)
    return NextResponse.json({ error: finalErr.message }, { status: 500 })
  }
  const finals = finalRows ?? []
  const finalStateMatchPct =
    finals.length === 0
      ? null
      : Math.round(
          (100 * finals.filter((r: { winner_match: boolean | null; score_match: boolean | null }) => r.winner_match === true && r.score_match === true).length) /
            finals.length
        )

  // perPointMatchPct — shadow_diff 7d
  const { data: ppRows, error: ppErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .select('point_sequence_match')
    .eq('comparison_type', 'per_point_sequence')
    .gte('computed_at', since7d)
  if (ppErr) {
    console.error('[Shadow Health] shadow_diff per_point query failed:', ppErr.message)
    return NextResponse.json({ error: ppErr.message }, { status: 500 })
  }
  const pps = ppRows ?? []
  const perPointMatchPct =
    pps.length === 0
      ? null
      : Math.round((100 * pps.filter((r: { point_sequence_match: boolean | null }) => r.point_sequence_match === true).length) / pps.length)

  // latency — shadow_diff live_latency 24h
  const { data: latRows, error: latErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .select('latency_delta_ms')
    .eq('comparison_type', 'live_latency')
    .gte('computed_at', since24h)
  if (latErr) {
    console.error('[Shadow Health] shadow_diff latency query failed:', latErr.message)
    return NextResponse.json({ error: latErr.message }, { status: 500 })
  }
  const latencies = (latRows ?? [])
    .map((r: { latency_delta_ms: number | null }) => r.latency_delta_ms)
    .filter((v): v is number => typeof v === 'number')
    .sort((a: number, b: number) => a - b)
  const latencyMedianMs = median(latencies)
  const latencyP95Ms = percentile(latencies, 0.95)

  return NextResponse.json({
    enrolledCount: enrolledCount ?? 0,
    livePollSuccessPct,
    unresolvedCount: unresolvedCount ?? 0,
    finalStateMatchPct,
    perPointMatchPct,
    latencyMedianMs,
    latencyP95Ms,
  })
}
