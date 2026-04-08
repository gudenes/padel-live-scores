// src/app/api/cron/premier-stats/route.ts
//
// Fetches Premier Padel stats for matches that are finished + have a
// Premier mapping + are missing or stale in match_stats.
//
// Day 3 (manual): triggered with ?limit=500&full_backfill=true to drain
// the entire 2026 backlog in one run.
// Day 2+ (scheduled): runs hourly with default limit=100 and 7-day lookback.

import { createClient } from '@supabase/supabase-js'
import { fetchPremierMatchDetail, withThrottle } from '@/lib/premier-api'
import { parseMatchStatsPayload } from '@/lib/premier-stats-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const LOOKBACK_DAYS = 7
const BACKFILL_CUTOFF = '2026-01-01'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const requestedLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
  const limit = Math.min(
    Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  )
  const fullBackfill = url.searchParams.get('full_backfill') === 'true'

  const startedAt = Date.now()
  const cutoff = fullBackfill
    ? BACKFILL_CUTOFF
    : new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  console.log(`[premier-stats] starting: limit=${limit} full_backfill=${fullBackfill} cutoff=${cutoff}`)

  // Step 1: Get all Premier match mappings
  const { data: eeiRows, error: eeiErr } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'match')
    .eq('source', 'premierpadel')
    .limit(2000) // Safety cap

  if (eeiErr) {
    return Response.json({ error: 'Failed to load mappings', detail: eeiErr.message }, { status: 500 })
  }

  const mappedMatchIds = (eeiRows ?? []).map(r => r.entity_id as string)
  if (mappedMatchIds.length === 0) {
    return Response.json({
      ok: true,
      synced: 0,
      errored: 0,
      skipped: 0,
      candidates: 0,
      reason: 'no mappings',
      elapsed_ms: Date.now() - startedAt,
    })
  }

  // Build premier_match_id lookup: our UUID → Premier match ID
  const premierIdByMatchId = new Map<string, string>()
  for (const r of eeiRows ?? []) {
    premierIdByMatchId.set(r.entity_id as string, r.external_id as string)
  }

  // Step 2: Get finished matches in the lookback window that are mapped
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select('id, finished_at')
    .in('id', mappedMatchIds)
    .eq('status', 'finished')
    .gte('finished_at', cutoff)
    .order('finished_at', { ascending: false })
    .limit(limit)

  if (matchErr) {
    return Response.json({ error: 'Failed to load matches', detail: matchErr.message }, { status: 500 })
  }

  const candidateMatchIds = (matchRows ?? []).map(m => m.id as string)
  if (candidateMatchIds.length === 0) {
    return Response.json({
      ok: true,
      synced: 0,
      errored: 0,
      skipped: 0,
      candidates: 0,
      reason: 'no finished mapped matches in window',
      total_mapped: mappedMatchIds.length,
      elapsed_ms: Date.now() - startedAt,
    })
  }

  // Step 3: Load existing match_stats aggregate rows to check freshness
  const { data: existingStats } = await supabase
    .from('match_stats')
    .select('match_id, computed_at')
    .in('match_id', candidateMatchIds)
    .eq('set_number', 0)

  const freshByMatchId = new Map<string, string>()
  for (const s of existingStats ?? []) {
    freshByMatchId.set(s.match_id as string, s.computed_at as string)
  }

  // Step 4: Filter to matches that need sync (missing or stale)
  const needsSync: Array<{ matchId: string; premierMatchId: string; finishedAt: string }> = []
  for (const m of matchRows ?? []) {
    const existing = freshByMatchId.get(m.id as string)
    const finishedAt = m.finished_at as string
    if (!existing || new Date(existing) < new Date(finishedAt)) {
      const premierMatchId = premierIdByMatchId.get(m.id as string)
      if (premierMatchId) {
        needsSync.push({
          matchId: m.id as string,
          premierMatchId,
          finishedAt,
        })
      }
    }
  }

  console.log(`[premier-stats] total_mapped=${mappedMatchIds.length} candidates=${candidateMatchIds.length} needs_sync=${needsSync.length}`)

  // Step 5: Fetch + parse + upsert each match
  let synced = 0
  let errored = 0
  let skipped = 0

  for (const row of needsSync) {
    const detail = await withThrottle(() => fetchPremierMatchDetail(Number(row.premierMatchId)))
    if (!detail) {
      skipped++
      continue
    }
    const parsed = parseMatchStatsPayload(detail)
    if (!parsed) {
      skipped++
      continue
    }

    // Attach match_id + provenance to each parsed row
    const upsertRows = parsed.map(r => ({
      match_id: row.matchId,
      ...r,
      source: 'premierpadel' as const,
      source_match_id: row.premierMatchId,
      raw_payload: r.set_number === 0 ? detail : null,
      computed_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('match_stats')
      .upsert(upsertRows, { onConflict: 'match_id,set_number' })

    if (error) {
      console.error(`[premier-stats] upsert error for match ${row.matchId}:`, error)
      errored++
    } else {
      synced++
    }
  }

  console.log(`[premier-stats] done: synced=${synced} errored=${errored} skipped=${skipped}`)

  return Response.json({
    ok: true,
    synced,
    errored,
    skipped,
    candidates: needsSync.length,
    total_mapped: mappedMatchIds.length,
    limit,
    full_backfill: fullBackfill,
    elapsed_ms: Date.now() - startedAt,
  })
}
