// src/app/api/ops/padelgod-health/route.ts
//
// GET /api/ops/padelgod-health
//
// Aggregate health view for the padelgod data-acquisition layer:
//   - tournament-discovery worker (padelfip.com WP events → tournaments)
//   - widget-code-lookup worker (matchscorerlive.com search → widget_id_cache)
//   - static fetchers (entry_list / oop / results / draw)
//   - cross-source linkage coverage (orphan twins awaiting link)
//
// The Explorer's per-tournament view was already showing "is this one
// tournament OK?". This endpoint answers the fleet-level version:
// "is the padelgod discovery layer doing its job?".
//
// Auth: ops_token cookie.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ── Response shape ───────────────────────────────────────────────────────

interface WorkerStats {
  label: string
  jobType: string
  lastRun: string | null
  lastStatus: 'success' | 'failed' | 'running' | null
  runsLast24h: number
  failuresLast24h: number
  successRate24h: number | null // null when no runs
  lastError: string | null
}

interface Coverage {
  tournamentsTotal: number
  withFipId: number
  withPadelapiId: number
  withBoth: number
  orphanFipOnly: number // source='fip' with padelapi_id=null (potential twins)
}

interface WidgetCoverage {
  total: number
  byMethod: Record<string, number>
  mostRecent: string | null
}

interface SnapshotCoverage {
  entryList: number
  oop: number
  results: number
  draw: number
  // Most recent captured_at across each table
  entryListLatest: string | null
  oopLatest: string | null
  resultsLatest: string | null
  drawLatest: string | null
}

interface HealthResponse {
  workers: WorkerStats[]
  coverage: Coverage
  widgetCoverage: WidgetCoverage
  snapshotCoverage: SnapshotCoverage
  generatedAt: string
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Fire all queries in parallel. Order within the await doesn't matter —
  // this is one shot per tab open.
  const [
    discoverLatest,
    widgetLatest,
    entryListLatest,
    oopLatest,
    resultsLatest,
    drawLatest,
    discoverRuns,
    widgetRuns,
    entryListRuns,
    oopRuns,
    resultsRuns,
    drawRuns,
    tournamentsAll,
    widgetCacheAll,
    entryCount,
    oopCount,
    resultsCount,
    drawCount,
  ] = await Promise.all([
    // Latest scrape_job per type (for lastRun + lastStatus + lastError)
    supabase.schema('padelgod').from('scrape_jobs')
      .select('started_at, status, error_message')
      .eq('job_type', 'discover').is('tournament_id', null)
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.schema('padelgod').from('scrape_jobs')
      .select('started_at, status, error_message')
      .eq('job_type', 'widget_id')
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.schema('padelgod').from('scrape_jobs')
      .select('started_at, status, error_message')
      .eq('job_type', 'discover').not('tournament_id', 'is', null)
      .like('target_url', '%entrylist%')
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.schema('padelgod').from('scrape_jobs')
      .select('started_at, status, error_message')
      .eq('job_type', 'oop')
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.schema('padelgod').from('scrape_jobs')
      .select('started_at, status, error_message')
      .eq('job_type', 'oop')
      .like('target_url', '%resultsbyday%')
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.schema('padelgod').from('scrape_jobs')
      .select('started_at, status, error_message')
      .eq('job_type', 'draw')
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),

    // 24h run/failure counts for each worker
    runCount(since24h, { jobType: 'discover', tournamentIdIsNull: true }),
    runCount(since24h, { jobType: 'widget_id' }),
    runCount(since24h, { jobType: 'discover', urlLike: '%entrylist%' }),
    runCount(since24h, { jobType: 'oop', urlNotLike: '%resultsbyday%' }),
    runCount(since24h, { jobType: 'oop', urlLike: '%resultsbyday%' }),
    runCount(since24h, { jobType: 'draw' }),

    // Tournament coverage
    supabase.from('tournaments').select('id, source, fip_id, padelapi_id'),
    // Widget cache coverage
    supabase.schema('padelgod').from('widget_id_cache')
      .select('extraction_method, last_validated_at')
      .order('last_validated_at', { ascending: false }),

    // Snapshot row counts — head-only for speed
    supabase.schema('padelgod').from('entry_list_snapshots').select('*', { count: 'exact', head: true }),
    supabase.schema('padelgod').from('oop_snapshots').select('*', { count: 'exact', head: true }),
    supabase.schema('padelgod').from('results_snapshots').select('*', { count: 'exact', head: true }),
    supabase.schema('padelgod').from('draw_snapshots').select('*', { count: 'exact', head: true }),
  ])

  // Most-recent captured_at per snapshot table — one extra lightweight query
  // each (covered by the index on captured_at).
  const [
    entryListLatestRow,
    oopLatestRow,
    resultsLatestRow,
    drawLatestRow,
  ] = await Promise.all([
    supabase.schema('padelgod').from('entry_list_snapshots')
      .select('captured_at').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.schema('padelgod').from('oop_snapshots')
      .select('captured_at').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.schema('padelgod').from('results_snapshots')
      .select('captured_at').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.schema('padelgod').from('draw_snapshots')
      .select('captured_at').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  // Build worker stats rows
  const workers: WorkerStats[] = [
    toWorkerStats('Tournament discovery', 'discover', discoverLatest.data, discoverRuns),
    toWorkerStats('Widget code lookup', 'widget_id', widgetLatest.data, widgetRuns),
    toWorkerStats('Entry-list fetcher', 'entrylist', entryListLatest.data, entryListRuns),
    toWorkerStats('OOP fetcher', 'oop', oopLatest.data, oopRuns),
    toWorkerStats('Results fetcher', 'resultsbyday', resultsLatest.data, resultsRuns),
    toWorkerStats('Draw fetcher', 'draw', drawLatest.data, drawRuns),
  ]

  // Coverage
  const tournaments = (tournamentsAll.data ?? []) as Array<{
    source: string | null
    fip_id: string | null
    padelapi_id: string | null
  }>
  const coverage: Coverage = {
    tournamentsTotal: tournaments.length,
    withFipId: tournaments.filter((t) => t.fip_id).length,
    withPadelapiId: tournaments.filter((t) => t.padelapi_id).length,
    withBoth: tournaments.filter((t) => t.fip_id && t.padelapi_id).length,
    orphanFipOnly: tournaments.filter((t) => t.source === 'fip' && t.fip_id && !t.padelapi_id).length,
  }

  // Widget cache breakdown
  const widgetRows = (widgetCacheAll.data ?? []) as Array<{
    extraction_method: string
    last_validated_at: string
  }>
  const byMethod: Record<string, number> = {}
  for (const r of widgetRows) {
    byMethod[r.extraction_method] = (byMethod[r.extraction_method] ?? 0) + 1
  }
  const widgetCoverage: WidgetCoverage = {
    total: widgetRows.length,
    byMethod,
    mostRecent: widgetRows[0]?.last_validated_at ?? null,
  }

  const snapshotCoverage: SnapshotCoverage = {
    entryList: entryCount.count ?? 0,
    oop: oopCount.count ?? 0,
    results: resultsCount.count ?? 0,
    draw: drawCount.count ?? 0,
    entryListLatest: entryListLatestRow.data?.captured_at ?? null,
    oopLatest: oopLatestRow.data?.captured_at ?? null,
    resultsLatest: resultsLatestRow.data?.captured_at ?? null,
    drawLatest: drawLatestRow.data?.captured_at ?? null,
  }

  const response: HealthResponse = {
    workers,
    coverage,
    widgetCoverage,
    snapshotCoverage,
    generatedAt: new Date().toISOString(),
  }
  return Response.json(response)
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function runCount(
  since: string,
  filter: {
    jobType: string
    tournamentIdIsNull?: boolean
    urlLike?: string
    urlNotLike?: string
  },
): Promise<{ total: number; failures: number }> {
  // We issue two COUNT queries — one for total, one for failures — each
  // scoped to the 24h window. Cheap enough; this page is operator-only.
  const base = () => {
    let q = supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('job_type', filter.jobType)
      .gte('started_at', since)
    if (filter.tournamentIdIsNull === true) q = q.is('tournament_id', null)
    if (filter.tournamentIdIsNull === false) q = q.not('tournament_id', 'is', null)
    if (filter.urlLike) q = q.like('target_url', filter.urlLike)
    if (filter.urlNotLike) q = q.not('target_url', 'like', filter.urlNotLike)
    return q
  }

  const [totalRes, failRes] = await Promise.all([
    base(),
    base().eq('status', 'failed'),
  ])
  return {
    total: totalRes.count ?? 0,
    failures: failRes.count ?? 0,
  }
}

function toWorkerStats(
  label: string,
  jobType: string,
  latest: { started_at: string; status: string; error_message: string | null } | null,
  runs: { total: number; failures: number },
): WorkerStats {
  return {
    label,
    jobType,
    lastRun: latest?.started_at ?? null,
    lastStatus: (latest?.status as WorkerStats['lastStatus']) ?? null,
    runsLast24h: runs.total,
    failuresLast24h: runs.failures,
    successRate24h: runs.total === 0 ? null : Math.round(((runs.total - runs.failures) / runs.total) * 100),
    lastError: latest?.error_message ?? null,
  }
}
