// src/app/api/cron/fip-entry-list/route.ts
//
// Auto-scrape FIP entry lists for tournaments that have a fip_id and a
// near-term schedule but no fresh padelgod entry-list snapshot. Closes
// the manual gap that operators had been hitting via the
// /api/ops/seed-fip-entry-list endpoint, one tournament at a time.
//
// What it does each run:
//   1. Find tournaments with fip_id, starts_at within (now - 7d, now + 14d).
//      That's the "imminent" window where padelfip.com has actually
//      published the PDF and operators care about the entry list.
//   2. For each, check the most recent padelgod.entry_list_snapshots
//      `captured_at`. Skip if fresher than STALE_AFTER_HOURS hours.
//   3. Call the same pipeline + persist functions the manual ops endpoint
//      uses, so behaviour is identical and any improvement to those
//      libraries propagates here automatically.
//   4. Cap per-run at MAX_PER_RUN tournaments so a bad upstream doesn't
//      consume the entire 60s function budget. Remaining work just rolls
//      to the next cron tick.
//
// Schedule: every 4 hours via vercel.json. Frequency is a tradeoff — too
// often wastes upstream PDF fetches, too rare and entry lists go stale
// when published mid-day. 4h fits all FIP weekend tournament windows
// (entry lists usually drop Mon/Tue, picked up by Wed and refreshed
// through Fri).
//
// Auth: Bearer CRON_SECRET (matches the other crons).

import { createClient } from '@supabase/supabase-js'
import { runFipEntryListPipeline } from '@/lib/fip-entry-list-pipeline'
import { persistPipelineResult } from '@/lib/fip-entry-list-persist'
import { PlayerResolver } from '@/lib/player-resolver'

export const maxDuration = 60

// Tunables
const MAX_PER_RUN = 10
const STALE_AFTER_HOURS = 24
const WINDOW_DAYS_PAST = 7
const WINDOW_DAYS_FUTURE = 14

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface PerTournamentResult {
  id: string
  name: string
  ok: boolean
  playersInserted?: number
  snapshotsInserted?: number
  error?: string
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const now = Date.now()
  const fromDate = new Date(now - WINDOW_DAYS_PAST * 86400000).toISOString()
  const toDate = new Date(now + WINDOW_DAYS_FUTURE * 86400000).toISOString()

  // 1. Candidate tournaments — has fip_id, in the window
  const { data: candidates, error: candErr } = await supabase
    .from('tournaments')
    .select('id, name, fip_id, starts_at, ends_at')
    .not('fip_id', 'is', null)
    .gte('starts_at', fromDate)
    .lte('starts_at', toDate)
    .order('starts_at', { ascending: true })
    .limit(200)

  if (candErr) {
    return Response.json(
      { ok: false, error: `candidate query failed: ${candErr.message}` },
      { status: 500 },
    )
  }

  const allCandidateIds = (candidates ?? []).map(t => t.id as string)

  if (allCandidateIds.length === 0) {
    return Response.json({
      ok: true,
      candidates: 0,
      reason: 'no FIP tournaments in window',
      elapsed_ms: Date.now() - startedAt,
    })
  }

  // 2. Most-recent snapshot per tournament — single bulk query, then
  //    bucket client-side. Saves N round-trips when N is large.
  const { data: snapRows } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select('tournament_id, captured_at')
    .in('tournament_id', allCandidateIds)
    .order('captured_at', { ascending: false })

  const latestPerTournament = new Map<string, string>()
  for (const r of (snapRows ?? []) as Array<{ tournament_id: string; captured_at: string }>) {
    if (!latestPerTournament.has(r.tournament_id)) {
      latestPerTournament.set(r.tournament_id, r.captured_at)
    }
  }

  const staleCutoff = now - STALE_AFTER_HOURS * 60 * 60 * 1000

  const needsScrape = (candidates ?? []).filter(t => {
    const last = latestPerTournament.get(t.id as string)
    if (!last) return true  // never scraped
    return new Date(last).getTime() < staleCutoff
  }).slice(0, MAX_PER_RUN)

  if (needsScrape.length === 0) {
    return Response.json({
      ok: true,
      candidates: allCandidateIds.length,
      eligible: 0,
      reason: 'all candidates have fresh snapshots',
      elapsed_ms: Date.now() - startedAt,
    })
  }

  // 3. Run pipeline per tournament, sequentially. Parallelism would
  //    pile up on padelfip.com; the sequential loop is gentler and
  //    keeps the function within the 60s budget even when each scrape
  //    takes 3-5s.
  const resolver = new PlayerResolver(supabase)
  const results: PerTournamentResult[] = []

  for (const t of needsScrape) {
    const id = t.id as string
    const name = t.name as string
    const fipId = t.fip_id as string

    try {
      const pipelineResult = await runFipEntryListPipeline(
        { tournamentId: id, fipId },
        { resolver },
      )
      const persisted = await persistPipelineResult(supabase, pipelineResult)
      results.push({
        id,
        name,
        ok: true,
        playersInserted: persisted.playersInserted,
        snapshotsInserted: persisted.snapshotsInserted,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[fip-entry-list] tournament ${id} (${name}) failed: ${msg}`)
      results.push({ id, name, ok: false, error: msg })
    }
  }

  const ok = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  const totalPlayers = results.reduce((acc, r) => acc + (r.playersInserted ?? 0), 0)
  const totalSnapshots = results.reduce((acc, r) => acc + (r.snapshotsInserted ?? 0), 0)

  console.log(
    `[fip-entry-list] processed ${results.length}/${needsScrape.length} ` +
    `(ok=${ok} failed=${failed} players=${totalPlayers} snapshots=${totalSnapshots}) ` +
    `in ${Date.now() - startedAt}ms`,
  )

  return Response.json({
    ok: true,
    candidates: allCandidateIds.length,
    eligible: needsScrape.length,
    processed: results.length,
    succeeded: ok,
    failed,
    totalPlayersInserted: totalPlayers,
    totalSnapshotsInserted: totalSnapshots,
    results,
    elapsed_ms: Date.now() - startedAt,
  })
}
