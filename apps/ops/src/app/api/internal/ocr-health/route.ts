// apps/ops/src/app/api/internal/ocr-health/route.ts
//
// GET /api/internal/ocr-health
//
// Powers the OCR Health tab. Returns three views over the OCR pipeline:
//   1. 24h aggregate diff metrics (only meaningful once the shadow-diff
//      worker is enabled AND there are live matches with Crionet baselines)
//   2. 24h snapshot rollups (per stream_label + per parse_error state)
//   3. The 30 most recent raw snapshots (so operators can verify the worker
//      is alive and reading sensible values even when no diff baseline exists)
//
// The third view is the primary way to confirm a fresh Railway deploy is
// healthy — it works against any source URL, live or recorded, with or
// without a resolved match_id.
//
// Auth: Auth.js session — isOperator required.
// Supabase: serviceClient() (cross-schema read into padelgod).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const WINDOW_HOURS = 24
const RECENT_SNAPSHOTS_LIMIT = 30

interface DiffEventRow {
  agreement: string
  lag_seconds: number | null
}

interface SnapshotAggRow {
  ocr_confidence: number | null
  stream_label: string
  parsed_score: Record<string, unknown>
  captured_at: string
}

interface RecentSnapshotRow {
  id: number
  captured_at: string
  frame_at: string
  stream_label: string
  youtube_video_id: string
  court_label: string | null
  match_id: string | null
  ocr_confidence: number | null
  parsed_score: Record<string, unknown>
  worker_version: string
}

interface StreamRollup {
  stream_label: string
  total: number
  parsed_ok: number
  parsed_error: number
  mean_confidence: number | null
  latest_captured_at: string | null
  seconds_since_latest: number | null
}

interface HealthResponse {
  windowHours: number
  totalDiffs: number
  totalSnapshots: number
  matchRate: number
  agreementCounts: Record<string, number>
  meanLagSeconds: number | null
  meanConfidence: number | null
  streamRollups: StreamRollup[]
  recentSnapshots: RecentSnapshotRow[]
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString()
  const now = Date.now()

  // 1. Diff events (24h)
  const { data: diffData, error: diffError } = (await supabase
    .schema('padelgod')
    .from('ocr_diff_events')
    .select('agreement, lag_seconds')
    .gte('checked_at', cutoff)) as {
    data: DiffEventRow[] | null
    error: { message: string } | null
  }

  if (diffError) {
    return NextResponse.json({ error: diffError.message }, { status: 500 })
  }

  const diffRows = diffData ?? []
  const agreementCounts: Record<string, number> = {}
  let totalLag = 0
  let lagSamples = 0
  for (const row of diffRows) {
    agreementCounts[row.agreement] = (agreementCounts[row.agreement] ?? 0) + 1
    if (row.lag_seconds != null) {
      totalLag += row.lag_seconds
      lagSamples += 1
    }
  }

  const totalDiffs = diffRows.length
  const matchCount = agreementCounts['match'] ?? 0
  const matchRate = totalDiffs > 0 ? matchCount / totalDiffs : 0
  const meanLag = lagSamples > 0 ? totalLag / lagSamples : null

  // 2. Snapshot aggregates (24h)
  const { data: snapData, error: snapError } = (await supabase
    .schema('padelgod')
    .from('ocr_snapshots')
    .select('ocr_confidence, stream_label, parsed_score, captured_at')
    .gte('captured_at', cutoff)) as {
    data: SnapshotAggRow[] | null
    error: { message: string } | null
  }

  if (snapError) {
    return NextResponse.json({ error: snapError.message }, { status: 500 })
  }

  const snapRows = snapData ?? []
  const confidences = snapRows
    .map((s) => s.ocr_confidence)
    .filter((c): c is number => c != null)
  const meanConfidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null

  // Per-stream rollups
  const rollupsMap = new Map<string, StreamRollup>()
  for (const row of snapRows) {
    let r = rollupsMap.get(row.stream_label)
    if (!r) {
      r = {
        stream_label: row.stream_label,
        total: 0,
        parsed_ok: 0,
        parsed_error: 0,
        mean_confidence: null,
        latest_captured_at: null,
        seconds_since_latest: null,
      }
      rollupsMap.set(row.stream_label, r)
    }
    r.total += 1
    const pe = (row.parsed_score?.['parse_error'] as boolean | undefined) ?? false
    if (pe) r.parsed_error += 1
    else r.parsed_ok += 1
    if (!r.latest_captured_at || row.captured_at > r.latest_captured_at) {
      r.latest_captured_at = row.captured_at
    }
  }
  // Confidence + freshness per stream
  for (const r of rollupsMap.values()) {
    const streamConfidences = snapRows
      .filter((s) => s.stream_label === r.stream_label)
      .map((s) => s.ocr_confidence)
      .filter((c): c is number => c != null)
    r.mean_confidence =
      streamConfidences.length > 0
        ? streamConfidences.reduce((a, b) => a + b, 0) / streamConfidences.length
        : null
    if (r.latest_captured_at) {
      r.seconds_since_latest = Math.floor(
        (now - new Date(r.latest_captured_at).getTime()) / 1000,
      )
    }
  }
  const streamRollups = Array.from(rollupsMap.values()).sort(
    (a, b) => b.total - a.total,
  )

  // 3. 30 most recent snapshots (any window)
  const { data: recentData, error: recentError } = (await supabase
    .schema('padelgod')
    .from('ocr_snapshots')
    .select(
      'id, captured_at, frame_at, stream_label, youtube_video_id, court_label, match_id, ocr_confidence, parsed_score, worker_version',
    )
    .order('captured_at', { ascending: false })
    .limit(RECENT_SNAPSHOTS_LIMIT)) as {
    data: RecentSnapshotRow[] | null
    error: { message: string } | null
  }

  if (recentError) {
    return NextResponse.json({ error: recentError.message }, { status: 500 })
  }

  const body: HealthResponse = {
    windowHours: WINDOW_HOURS,
    totalDiffs,
    totalSnapshots: snapRows.length,
    matchRate,
    agreementCounts,
    meanLagSeconds: meanLag,
    meanConfidence,
    streamRollups,
    recentSnapshots: recentData ?? [],
  }

  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
}
