// HTTP cron shim. Keep JOBS in sync with vercel.json until Vercel is retired.
//
// Deliberate exception: /api/cron/reconcile-match-category is Railway-only.
// The old Vercel deployment is still serving, so anything added to BOTH
// lists fires twice. New jobs land here only — vercel.json stays frozen
// until that deployment is torn down.
import { CronJob } from 'cron'

const BASE = (process.env.CRON_BASE_URL || process.env.AUTH_URL || '').replace(/\/$/, '')
const SECRET = process.env.CRON_SECRET

// Second origin: the admin app (apps/ops). Jobs marked `target: 'admin'` call it
// instead of the web app. Point ADMIN_BASE_URL at the *.up.railway.app host, not
// admin.padelnachos.com, so cron traffic skips Cloudflare (100s origin cap).
const ADMIN_BASE = (process.env.ADMIN_BASE_URL || '').replace(/\/$/, '')
const baseFor = job => (job.target === 'admin' ? ADMIN_BASE : BASE)

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
  // Admin app (apps/ops) — was apps/ops/vercel.json, same schedules. A job whose
  // base is unset is skipped with one log line instead of hitting a bad URL.
  { path: '/api/internal/seo-snapshot', cron: '0 9 * * *', target: 'admin' },
  { path: '/api/internal/sitemap-crawl', cron: '15 9 * * *', target: 'admin' },
  { path: '/api/internal/seo-digest', cron: '30 9 * * *', target: 'admin' },
  // PostHog growth metrics for the last complete UTC day; needs POSTHOG_* on the admin.
  { path: '/api/internal/growth-snapshot', cron: '45 9 * * *', target: 'admin' },
]

async function fire(path, base) {
  const url = `${base}${path}`
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
  const base = baseFor(job)
  if (!base) {
    console.log(JSON.stringify({ msg: 'skipped', path: job.path, reason: 'ADMIN_BASE_URL unset' }))
    continue
  }
  CronJob.from({
    cronTime: job.cron,
    onTick: () => fire(job.path, base),
    start: true,
    timeZone: 'UTC',
  })
  console.log(JSON.stringify({ msg: 'scheduled', path: job.path, cron: job.cron }))
}

console.log(JSON.stringify({ msg: 'cron-runner-up', base: BASE, jobs: JOBS.length, release: process.env.RELEASE_SHA || null }))
