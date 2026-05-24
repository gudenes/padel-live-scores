// apps/ops/src/app/api/internal/ocr-health/route.ts
//
// GET /api/internal/ocr-health
//
// Aggregate health view for the OCR worker shadow-diff pipeline.
// Reads padelgod.ocr_diff_events + padelgod.ocr_snapshots from the last
// 24 hours and computes the metrics rendered by the OCR Health tab.
//
// Auth: Auth.js session — isOperator required.
// Supabase: serviceClient() (cross-schema read into padelgod).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const WINDOW_HOURS = 24

interface DiffEventRow {
  agreement: string
  lag_seconds: number | null
}

interface SnapshotRow {
  ocr_confidence: number | null
}

interface HealthResponse {
  windowHours: number
  totalDiffs: number
  totalSnapshots: number
  matchRate: number
  agreementCounts: Record<string, number>
  meanLagSeconds: number | null
  meanConfidence: number | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString()

  const { data: diffData, error: diffError } = (await supabase
    .schema('padelgod')
    .from('ocr_diff_events')
    .select('agreement, lag_seconds')
    .gte('checked_at', cutoff)) as { data: DiffEventRow[] | null; error: { message: string } | null }

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

  const { data: snapData, error: snapError } = (await supabase
    .schema('padelgod')
    .from('ocr_snapshots')
    .select('ocr_confidence')
    .gte('captured_at', cutoff)) as { data: SnapshotRow[] | null; error: { message: string } | null }

  if (snapError) {
    return NextResponse.json({ error: snapError.message }, { status: 500 })
  }

  const snapRows = snapData ?? []
  const confidences = snapRows
    .map((s) => s.ocr_confidence)
    .filter((c): c is number => c != null)
  const meanConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null

  const body: HealthResponse = {
    windowHours: WINDOW_HOURS,
    totalDiffs,
    totalSnapshots: snapRows.length,
    matchRate,
    agreementCounts,
    meanLagSeconds: meanLag,
    meanConfidence,
  }

  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
}
