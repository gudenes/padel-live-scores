// src/app/api/ops/seed-fip-tournament/route.ts
// POST /api/ops/seed-fip-tournament
//
// One-shot orchestration for bringing up a FIP-only tournament end-to-end.
// Runs the three steps that would otherwise each require a separate manual
// action (SQL + API call + padelgod cron wait):
//
//   1. UPSERT the Crionet widget_id into padelgod.widget_id_cache
//      — unblocks the existing padelgod static fetchers (draw / OOP / results)
//
//   2. Run the FIP PDF entry-list pipeline
//      (src/lib/fip-entry-list-pipeline + persist) — populates
//      public.players (for FIP-search-resolved players) and
//      padelgod.entry_list_snapshots
//
//   3. Trigger padelgod workers via /admin/run-worker (optional —
//      gated on PADELGOD_URL + PADELGOD_ADMIN_TOKEN being set):
//        draw-fetcher → oop-fetcher → results-fetcher → static-reconciler
//      Serialized — each depends on its predecessor's writes. If padelgod
//      triggering isn't configured, we skip step 3 and the existing cron
//      ticks will pick it up within ~90min.
//
// Auth: ops_token cookie.
// Body: { tournamentId: string; widgetId: string; skipPadelgod?: boolean; only?: 'men' | 'women' }

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { PlayerResolver } from '@/lib/player-resolver'
import { runFipEntryListPipeline } from '@/lib/fip-entry-list-pipeline'
import { persistPipelineResult } from '@/lib/fip-entry-list-persist'
import {
  getPadelgodAdminOptionsFromEnv,
  triggerPadelgodWorkersSequential,
  type WorkerName,
  type WorkerResult,
} from '@/lib/padelgod-admin-client'

// Workers that need to run, in order, after fresh entry-list data lands.
// Pair names with what their run produces:
//   draw-fetcher      → padelgod.draw_snapshots (bracket + inline results)
//   oop-fetcher       → padelgod.oop_snapshots (per-day schedule)
//   results-fetcher   → padelgod.results_snapshots (final scores per day)
//   static-reconciler → public.matches + public.sets + public.tournament_draws
const WORKER_SEQUENCE: WorkerName[] = [
  'draw-fetcher',
  'oop-fetcher',
  'results-fetcher',
  'static-reconciler',
]

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is not set')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

interface RequestBody {
  tournamentId?: unknown
  widgetId?: unknown
  skipPadelgod?: unknown
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
  const widgetId = typeof body.widgetId === 'string' ? body.widgetId.trim() : null
  const skipPadelgod = body.skipPadelgod === true
  const only = body.only === 'men' || body.only === 'women' ? body.only : undefined

  if (!tournamentId) {
    return Response.json({ ok: false, error: 'tournamentId is required' }, { status: 400 })
  }
  if (!widgetId) {
    return Response.json({ ok: false, error: 'widgetId is required' }, { status: 400 })
  }
  // Widget IDs on matchscorerlive take the form `FIP-YYYY-NNNN` (and a few
  // `FIP-YYYY-PNNNN` variants). Loose validation — just reject clearly malformed input.
  if (!/^FIP-\d{4}-[A-Z0-9]{3,6}$/.test(widgetId)) {
    return Response.json(
      { ok: false, error: `widgetId "${widgetId}" does not match expected FIP-YYYY-NNNN format` },
      { status: 400 }
    )
  }

  const supabase = getServiceClient()

  // Look up tournament → confirm FIP id present
  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, fip_id, padelapi_id')
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
      { ok: false, error: 'tournament has no fip_id — cannot scrape padelfip.com' },
      { status: 400 }
    )
  }

  // ── Step 1: cache widget_id ───────────────────────────────────────
  // padelgod.widget_id_cache requires extraction_method ∈
  // ('search', 'iframe', 'page_regex', 'manual'). The operator supplies the
  // widget_id in the request body here, so it's 'manual' — padelgod's own
  // widget-code-lookup worker uses 'search'/'iframe'/'page_regex' when it
  // auto-discovers. `last_validated_at` gets refreshed on every upsert so
  // stale-cache eviction (if any) sees recent activity.
  const nowIso = new Date().toISOString()
  const { error: widgetErr } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .upsert(
      {
        tournament_id: tournamentId,
        widget_id: widgetId,
        is_active: true,
        extraction_method: 'manual',
        last_validated_at: nowIso,
      },
      { onConflict: 'tournament_id' }
    )
  if (widgetErr) {
    return Response.json(
      { ok: false, error: `widget_id_cache upsert failed: ${widgetErr.message}` },
      { status: 500 }
    )
  }

  // ── Step 2: entry-list pipeline + persist ─────────────────────────
  const resolver = new PlayerResolver(supabase)
  let entryListSummary: {
    scrapeJobId: string
    playersInserted: number
    snapshotsInserted: number
    stats: unknown
    unresolvedCount: number
  }
  try {
    const result = await runFipEntryListPipeline(
      { tournamentId, fipId: tournament.fip_id, ...(only ? { only } : {}) },
      { resolver }
    )
    const persist = await persistPipelineResult(supabase, result)
    entryListSummary = {
      scrapeJobId: persist.scrapeJobId,
      playersInserted: persist.playersInserted,
      snapshotsInserted: persist.snapshotsInserted,
      stats: result.stats,
      unresolvedCount: result.unresolved.length,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json(
      { ok: false, error: `entry-list pipeline failed: ${msg}`, stage: 'entry_list' },
      { status: 500 }
    )
  }

  // ── Step 3: trigger padelgod workers (optional) ───────────────────
  let padelgodResults: WorkerResult[] | null = null
  let padelgodSkipReason: string | null = null

  if (skipPadelgod) {
    padelgodSkipReason = 'skipPadelgod=true in request body'
  } else {
    const admin = getPadelgodAdminOptionsFromEnv()
    if (!admin) {
      padelgodSkipReason =
        'PADELGOD_URL and/or PADELGOD_ADMIN_TOKEN not set — workers will run on their next cron tick'
    } else {
      padelgodResults = await triggerPadelgodWorkersSequential(WORKER_SEQUENCE, admin)
    }
  }

  return Response.json({
    ok: true,
    tournament: {
      id: tournament.id,
      name: tournament.name,
      fip_id: tournament.fip_id,
    },
    steps: {
      widgetIdCached: { widget_id: widgetId },
      entryList: entryListSummary,
      padelgodWorkers: padelgodResults,
      padelgodSkipReason,
    },
  })
}
