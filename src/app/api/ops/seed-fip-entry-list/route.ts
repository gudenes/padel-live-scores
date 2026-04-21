// src/app/api/ops/seed-fip-entry-list/route.ts
// POST /api/ops/seed-fip-entry-list — runs the FIP entry-list pipeline for a
// given tournament and persists the resulting snapshot to padelgod.
// Intended for FIP-only tournaments (no padelapi coverage); the pipeline will
// work on any tournament with a `fip_id` but writes go to the padelgod schema.
//
// Auth: ops_token cookie (httpOnly, set on /ops?token=... login).
//
// Body: { tournamentId: string, only?: 'men' | 'women' }
// Returns: { ok: true, scrapeJobId, playersInserted, snapshotsInserted, stats, pdfUrls }
//          or { ok: false, error: string } with an appropriate status code.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { PlayerResolver } from '@/lib/player-resolver'
import { runFipEntryListPipeline } from '@/lib/fip-entry-list-pipeline'
import { persistPipelineResult } from '@/lib/fip-entry-list-persist'

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is not set')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

interface RequestBody {
  tournamentId?: unknown
  only?: unknown
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const tournamentId = typeof body.tournamentId === 'string' ? body.tournamentId : null
  if (!tournamentId) {
    return Response.json({ ok: false, error: 'tournamentId is required' }, { status: 400 })
  }
  const only = body.only === 'men' || body.only === 'women' ? body.only : undefined

  const supabase = getServiceClient()

  // Look up tournament → fip_id. Must be a tournament with a FIP id; we can't
  // scrape padelfip.com without one.
  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('id, fip_id, name')
    .eq('id', tournamentId)
    .maybeSingle()

  if (tErr) {
    return Response.json({ ok: false, error: `tournament lookup failed: ${tErr.message}` }, { status: 500 })
  }
  if (!tournament) {
    return Response.json({ ok: false, error: `tournament ${tournamentId} not found` }, { status: 404 })
  }
  if (!tournament.fip_id) {
    return Response.json(
      { ok: false, error: `tournament has no fip_id — cannot scrape padelfip.com` },
      { status: 400 }
    )
  }

  const resolver = new PlayerResolver(supabase)

  try {
    const result = await runFipEntryListPipeline(
      { tournamentId, fipId: tournament.fip_id, ...(only ? { only } : {}) },
      { resolver }
    )
    const persist = await persistPipelineResult(supabase, result)

    return Response.json({
      ok: true,
      tournament: { id: tournament.id, name: tournament.name, fip_id: tournament.fip_id },
      scrapeJobId: persist.scrapeJobId,
      playersInserted: persist.playersInserted,
      snapshotsInserted: persist.snapshotsInserted,
      stats: result.stats,
      pdfUrls: result.pdfUrls,
      unresolved: result.unresolved,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[seed-fip-entry-list] pipeline failed:', msg)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
