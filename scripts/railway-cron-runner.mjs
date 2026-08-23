// HTTP cron shim. Keep JOBS in sync with vercel.json until Vercel is retired.
//
// Deliberate exception: /api/cron/reconcile-match-category is Railway-only.
// The old Vercel deployment is still serving, so anything added to BOTH
// lists fires twice. New jobs land here only — vercel.json stays frozen
// until that deployment is torn down.
import { CronJob } from 'cron'

const BASE = (process.env.CRON_BASE_URL || process.env.AUTH_URL || '').replace(/\/$/, '')
const SECRET = process.env.CRON_SECRET

if (!BASE) {
  console.error('[cron-runner] CRON_BASE_URL or AUTH_URL required')
  process.exit(1)
}
if (!SECRET) {
  console.error('[cron-runner] CRON_SECRET required')
  process.exit(1)
}

const JOBS = [
  { path: '/api/cron/process-factsheets', cron: '8 */2 * * *' },
  { path: '/api/cron/sync-highlights', cron: '20 */1 * * *' },
  { path: '/api/cron/youtube-channels-discover', cron: '*/5 * * * *' },
  { path: '/api/cron/sync-articles', cron: '40 */1 * * *' },
  { path: '/api/cron/enrich-articles', cron: '*/15 * * * *' },
  { path: '/api/cron/regenerate-dynamic-sources', cron: '0 5 * * 1' },
  { path: '/api/cron/sync-articles-dynamic', cron: '0 3 * * 3' },
  { path: '/api/cron/refresh-source-volume', cron: '0 4 * * *' },
  { path: '/api/cron/quality-scores', cron: '7 * * * *' },
  { path: '/api/cron/nacho-health', cron: '0 7 * * *' },
  { path: '/api/cron/sync-broadcasters', cron: '0 4 * * 0' },
  { path: '/api/cron/oop-monitor', cron: '30 */2 * * *' },
  { path: '/api/cron/editorial-gen', cron: '0 6 * * *' },
  { path: '/api/cron/anon-push-cleanup', cron: '0 4 * * 1' },
  { path: '/api/cron/resolve-predictions', cron: '*/5 * * * *' },
  { path: '/api/cron/recompute-earnings', cron: '0 6 * * 1' },
  { path: '/api/cron/reconcile-match-category', cron: '25 * * * *' },
]

async function fire(path) {
  const url = `${BASE}${path}`
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    const ms = Date.now() - started
    console.log(JSON.stringify({ msg: 'cron', path, status: res.status, ms }))
  } catch (err) {
    console.error(JSON.stringify({ msg: 'cron-error', path, err: String(err) }))
  }
}

for (const job of JOBS) {
  CronJob.from({
    cronTime: job.cron,
    onTick: () => fire(job.path),
    start: true,
    timeZone: 'UTC',
  })
  console.log(JSON.stringify({ msg: 'scheduled', path: job.path, cron: job.cron }))
}

console.log(JSON.stringify({ msg: 'cron-runner-up', base: BASE, jobs: JOBS.length }))
