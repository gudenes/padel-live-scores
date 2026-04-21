// src/lib/fip-entry-list-persist.ts
// DB write layer for the FIP entry-list pipeline.
//
// Persists a `PipelineResult` by:
//   1. Creating a `padelgod.scrape_jobs` row (status='running')
//   2. Upserting any PipelineNewPlayer entries into `public.players` that are
//      not already present (keyed on `fip_id`)
//   3. Bulk-inserting `padelgod.entry_list_snapshots` rows with the new scrape_job_id
//   4. Marking the scrape_job 'success' (or 'failed' with an error_message on
//      any downstream error before rethrowing — so operators can inspect the
//      audit trail even on partial failures)

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PipelineResult, PipelineNewPlayer } from './fip-entry-list-pipeline'

export interface PersistResult {
  scrapeJobId: string
  playersInserted: number
  snapshotsInserted: number
}

const ADMIN_AJAX_URL = 'https://www.padelfip.com/wp-admin/admin-ajax.php'

export async function persistPipelineResult(
  supabase: SupabaseClient,
  result: PipelineResult
): Promise<PersistResult> {
  const startedAt = new Date()

  // 1. Create scrape_jobs row
  const { data: jobData, error: jobErr } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .insert({
      job_type: 'fip_pdf_entry_list',
      tournament_id: result.tournamentId,
      target_url: ADMIN_AJAX_URL,
      status: 'running',
      parser_version: 'fip_pdf_entry_list_v1',
    })
    .select('id')
    .single()

  if (jobErr || !jobData) {
    throw new Error(`scrape_jobs insert failed: ${jobErr?.message ?? 'no data returned'}`)
  }
  const scrapeJobId = jobData.id as string

  try {
    // 2. Upsert new players (those resolved via FIP search that aren't in public.players yet)
    const playersInserted = await upsertNewPlayers(supabase, result.newPlayers)

    // 3. Bulk-insert snapshots
    let snapshotsInserted = 0
    if (result.rows.length > 0) {
      const snapshotRows = result.rows.map(r => ({
        scrape_job_id: scrapeJobId,
        tournament_id: result.tournamentId,
        category: r.category,
        fip_id: r.fip_id,
        name: r.name,
        country: r.country,
        seed: r.seed,
        partner_fip_id: r.partner_fip_id,
        partner_name: r.partner_name,
      }))
      const { error: snapErr } = await supabase
        .schema('padelgod')
        .from('entry_list_snapshots')
        .insert(snapshotRows)
      if (snapErr) throw new Error(`entry_list_snapshots insert failed: ${snapErr.message}`)
      snapshotsInserted = snapshotRows.length
    }

    // 4. Mark success
    await markJob(supabase, scrapeJobId, 'success', null, startedAt)

    return { scrapeJobId, playersInserted, snapshotsInserted }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await markJob(supabase, scrapeJobId, 'failed', msg, startedAt)
    throw err
  }
}

async function upsertNewPlayers(
  supabase: SupabaseClient,
  newPlayers: PipelineNewPlayer[]
): Promise<number> {
  if (newPlayers.length === 0) return 0

  // Find which ones already exist so we don't clobber rows sourced elsewhere
  // (avatar/bio from padelapi, rankings from the fip_rankings cron, etc.).
  // Per `src/lib/source-priority.ts`: players.name is primarily owned by
  // padelapi, so we only INSERT when there's no existing row for this fip_id.
  const fipIds = newPlayers.map(p => p.fipId)
  const { data: existing, error: selErr } = await supabase
    .from('players')
    .select('fip_id')
    .in('fip_id', fipIds)
  if (selErr) throw new Error(`players select failed: ${selErr.message}`)

  const existingSet = new Set((existing ?? []).map((r: { fip_id: string }) => r.fip_id))
  const toInsert = newPlayers.filter(p => !existingSet.has(p.fipId))
  if (toInsert.length === 0) return 0

  const now = new Date().toISOString()
  const rows = toInsert.map(p => ({
    fip_id: p.fipId,
    external_id: p.fipId, // keep legacy column in sync — tournaments table triggers expect this
    name: p.name,
    country: p.country,
    category: p.category,
    ranking: p.rank,
    points: p.points,
    profile_url: p.profileUrl,
    source: 'fip',
    last_updated_by: 'padelgod',
    updated_at: now,
  }))

  const { error: insErr } = await supabase.from('players').insert(rows)
  if (insErr) throw new Error(`players insert failed: ${insErr.message}`)
  return rows.length
}

async function markJob(
  supabase: SupabaseClient,
  scrapeJobId: string,
  status: 'success' | 'failed',
  errorMessage: string | null,
  startedAt: Date
): Promise<void> {
  const now = new Date()
  const patch: Record<string, unknown> = {
    status,
    completed_at: now.toISOString(),
    duration_ms: now.getTime() - startedAt.getTime(),
  }
  if (errorMessage) patch.error_message = errorMessage
  // Swallow update errors — the caller is about to throw (or return success).
  // We don't want a scrape_job-update failure to mask the real error or the
  // successful upstream writes.
  await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .update(patch)
    .eq('id', scrapeJobId)
}
