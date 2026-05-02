/**
 * 48h soak report for the padelapi-departure cutover.
 *
 * Run at T+6h, T+24h, T+48h. Expectation: row counts grow as the tournament
 * progresses, no failed scrape jobs, no premier-stats unresolved entries.
 *
 * Usage:
 *   cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && \
 *     npx tsx .claude/worktrees/nervous-mcnulty-82d476/scripts/soak-asuncion.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const TID = '5027936c-9fd5-4309-83e7-44ee4620a207'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })

async function main() {
  console.log(`Soak report — ASUNCION P2 — ${new Date().toISOString()}`)
  console.log('-'.repeat(70))

  // 1. Match count + composite coverage
  const { count: matchCount } = await s.from('matches').select('*', { count: 'exact', head: true }).eq('tournament_id', TID)
  const { count: nullComposite } = await s.from('matches').select('*', { count: 'exact', head: true }).eq('tournament_id', TID).is('widget_id_composite', null)
  const { count: nullPid } = await s.from('matches').select('*', { count: 'exact', head: true }).eq('tournament_id', TID).is('padelapi_id', null)
  console.log(`matches: ${matchCount} (NULL composite: ${nullComposite}, NULL padelapi_id: ${nullPid})`)

  // 2. Player FK coverage
  const { data: matchIds } = await s.from('matches').select('id').eq('tournament_id', TID)
  const ids = (matchIds ?? []).map((m: { id: string }) => m.id)
  if (ids.length) {
    const { count: missingPlayer } = await s
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .in('id', ids)
      .or('pair1_player1_id.is.null,pair1_player2_id.is.null,pair2_player1_id.is.null,pair2_player2_id.is.null')
    console.log(`matches with at least one NULL player FK: ${missingPlayer ?? 0} / ${matchCount}`)
  }

  // 3. Status distribution
  const { data: statusRows } = await s.from('matches').select('status').eq('tournament_id', TID)
  const statusCounts: Record<string, number> = {}
  for (const r of (statusRows ?? []) as Array<{ status: string }>) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1
  console.log('status distribution:', statusCounts)

  // 4. Match-stats coverage on finished matches
  const { data: finishedRows } = await s.from('matches').select('id').eq('tournament_id', TID).in('status', ['finished', 'retired', 'walkover'])
  const finishedIds = (finishedRows ?? []).map((m: { id: string }) => m.id)
  if (finishedIds.length) {
    const { count: statsCount } = await s
      .from('match_stats')
      .select('*', { count: 'exact', head: true })
      .in('match_id', finishedIds)
      .eq('set_number', 0)
    console.log(`finished matches: ${finishedIds.length}, with match_stats row: ${statsCount ?? 0}`)
  } else {
    console.log('finished matches: 0 (tournament still in progress / not started)')
  }

  // 5. Scrape-job health (last 6h)
  const since = new Date(Date.now() - 6 * 60 * 60e3).toISOString()
  const { data: jobs } = await s
    .schema('padelgod' as never)
    .from('scrape_jobs')
    .select('job_type, status, error_message, started_at')
    .eq('tournament_id', TID)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
  const jobBuckets: Record<string, { ok: number; err: number; running: number }> = {}
  for (const j of (jobs ?? []) as Array<{ job_type: string; status: string }>) {
    if (!jobBuckets[j.job_type]) jobBuckets[j.job_type] = { ok: 0, err: 0, running: 0 }
    if (j.status === 'success') jobBuckets[j.job_type]!.ok++
    else if (j.status === 'error') jobBuckets[j.job_type]!.err++
    else jobBuckets[j.job_type]!.running++
  }
  console.log('scrape_jobs in last 6h (per job_type):')
  console.table(jobBuckets)
  const failed = (jobs ?? []).filter((j: { status: string }) => j.status === 'error')
  if (failed.length) {
    console.log('!! Failed jobs (last 6h):')
    for (const f of failed.slice(0, 5) as Array<{ job_type: string; started_at: string; error_message: string | null }>) {
      console.log(`  ${f.started_at} | ${f.job_type} | ${(f.error_message ?? '').slice(0, 100)}`)
    }
  }

  // 6. Premier-stats unresolved (global)
  const { count: unresolved } = await s
    .from('match_stats_unresolved')
    .select('*', { count: 'exact', head: true })
    .is('resolved_at', null)
  console.log(`global match_stats_unresolved (open): ${unresolved ?? 0}`)

  // 7. Cohort sanity — non-Premier mass-flipped tournaments
  const cutoff = new Date(Date.now() - 7 * 86400e3).toISOString()
  const { count: cohort } = await s
    .from('tournaments')
    .select('*', { count: 'exact', head: true })
    .eq('live_source', 'padelgod')
    .gte('ends_at', cutoff)
  console.log(`active tournaments still on live_source=padelgod: ${cohort}`)

  const { count: stillPadelapi } = await s
    .from('tournaments')
    .select('*', { count: 'exact', head: true })
    .eq('live_source', 'padelapi')
    .gte('ends_at', cutoff)
  console.log(`active tournaments still on live_source=padelapi: ${stillPadelapi} (should be 0 going forward)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
