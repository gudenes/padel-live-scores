// apps/ops/src/app/api/internal/ocr-snapshot/[id]/route.ts
//
// GET /api/internal/ocr-snapshot/:id
//
// Detail endpoint backing the OCR Health snapshot drawer. Returns:
//   - The full snapshot row (everything the worker wrote).
//   - A short-lived signed URL for `frame_storage_path` if a frame was retained
//     (the worker only retains low-confidence frames + a random sample, so this
//     can be null for normal-confidence snapshots).
//   - The calibration JSON used to capture this row, read from
//     apps/ocr-worker/calibrations/<stream_label>.json. The UI uses
//     `scoreboard_bbox` + the per-cell columns to draw the overlay.
//
// Auth: Auth.js session — isOperator required.
// Supabase: serviceClient() (cross-schema read into padelgod + storage signing).
//
// File access: the source of truth for calibrations is
// apps/ocr-worker/calibrations/. A predev/prebuild script
// (apps/ops/scripts/sync-ocr-calibrations.mjs) copies the JSONs into
// apps/ops/calibrations/ at build time — that destination is gitignored.
// We can't reference the sibling package directly via
// outputFileTracingIncludes because Turbopack rejects globs that navigate
// out of the project root.

import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// 5 minutes — long enough for the operator to click through, short enough that
// shoulder-surfing a stale tab buys nothing useful.
const FRAME_URL_EXPIRY_SECONDS = 300

const FRAMES_BUCKET = 'ocr-frames'

interface SnapshotRow {
  id: number
  captured_at: string
  frame_at: string
  stream_label: string
  youtube_video_id: string
  court_label: string | null
  match_id: string | null
  tournament_id: string | null
  ocr_confidence: number | null
  parsed_score: Record<string, unknown>
  raw_text: string | null
  worker_version: string
  frame_storage_path: string | null
}

interface ColumnSpec {
  x: number
  width: number
}

interface Calibration {
  stream_label?: string
  notes?: string
  scoreboard_bbox: [number, number, number, number]
  row_layout?: string
  pair_label_column?: ColumnSpec
  set_columns?: ColumnSpec[]
  current_set_column?: ColumnSpec
  current_game_column?: ColumnSpec
}

interface SnapshotDetailResponse {
  snapshot: SnapshotRow
  frameUrl: string | null
  calibration: Calibration | null
  calibrationError: string | null
}

// Read a calibration JSON from the local copy populated by the
// sync-ocr-calibrations script. Returns null + reason on any failure so the
// UI can still render the snapshot row + frame even when the calibration
// file is missing (the drawer falls back to a warning + raw image).
async function loadCalibration(
  streamLabel: string,
): Promise<{ calibration: Calibration | null; error: string | null }> {
  const calibrationPath = path.join(
    process.cwd(),
    'calibrations',
    `${streamLabel}.json`,
  )

  try {
    const raw = await readFile(calibrationPath, 'utf8')
    return { calibration: JSON.parse(raw) as Calibration, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { calibration: null, error: msg }
  }
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json(
      { error: 'id must be a positive integer' },
      { status: 400 },
    )
  }

  const supabase = serviceClient()

  // 1. Snapshot row
  const { data: snapshot, error: snapError } = (await supabase
    .schema('padelgod')
    .from('ocr_snapshots')
    .select(
      'id, captured_at, frame_at, stream_label, youtube_video_id, court_label, match_id, tournament_id, ocr_confidence, parsed_score, raw_text, worker_version, frame_storage_path',
    )
    .eq('id', numericId)
    .maybeSingle()) as {
    data: SnapshotRow | null
    error: { message: string; code?: string } | null
  }

  if (snapError) {
    return NextResponse.json({ error: snapError.message }, { status: 500 })
  }
  if (!snapshot) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // 2. Signed URL for the retained PNG, if any. Failures here are non-fatal —
  // the drawer falls back to a hint about bumping OCR_FRAME_RETENTION_RATE.
  let frameUrl: string | null = null
  if (snapshot.frame_storage_path) {
    const { data: signed, error: signError } = await supabase.storage
      .from(FRAMES_BUCKET)
      .createSignedUrl(snapshot.frame_storage_path, FRAME_URL_EXPIRY_SECONDS)
    if (!signError && signed?.signedUrl) {
      frameUrl = signed.signedUrl
    }
  }

  // 3. Calibration JSON — non-fatal if missing.
  const { calibration, error: calibrationError } = await loadCalibration(
    snapshot.stream_label,
  )

  const body: SnapshotDetailResponse = {
    snapshot,
    frameUrl,
    calibration,
    calibrationError,
  }

  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
}
