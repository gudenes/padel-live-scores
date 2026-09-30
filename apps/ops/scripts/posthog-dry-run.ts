// apps/ops/scripts/posthog-dry-run.ts
// Read-only check of the Growth page's HogQL queries against real PostHog.
// Writes NOTHING (no database access). Runs each query on its own so one
// failure doesn't hide the others, then assembles the snapshot rows.
//
// Run: POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=... \
//      npx tsx apps/ops/scripts/posthog-dry-run.ts [YYYY-MM-DD]

import { hogqlRunnerFromEnv } from '../src/lib/posthog/hogql'
import { collectPosthogRows, q } from '../src/lib/growth/posthog-metrics'

const day = process.argv[2] ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

async function main() {
  const run = hogqlRunnerFromEnv()
  console.log(`\nPostHog dry run for ${day} (no writes)\n`)

  const probes: Array<[string, string]> = [
    ['sanity: events in last 7d', `select count() from events where timestamp > now() - interval 7 day`],
    ['sanity: $pageview in last 7d', `select count() from events where event = '$pageview' and timestamp > now() - interval 7 day`],
    ['dau series (30d)', q.dauSeries(day)],
    ['wau', q.trailingActive(day, 7)],
    ['mau', q.trailingActive(day, 30)],
    ['referrers', q.referrers(day)],
    ['countries', q.countries(day)],
    ['cohort sizes', q.cohortSizes(day)],
    ['retention', q.retention(day)],
  ]
  let failed = 0
  for (const [name, query] of probes) {
    const t0 = Date.now()
    try {
      const rows = await run(query)
      console.log(`OK    ${name.padEnd(30)} ${String(rows.length).padStart(4)} rows  ${Date.now() - t0}ms  ${JSON.stringify(rows.slice(0, 2)).slice(0, 110)}`)
    } catch (e) {
      failed++
      console.log(`FAIL  ${name.padEnd(30)} ${String(e).slice(0, 300)}`)
    }
  }

  if (failed === 0) {
    const rows = await collectPosthogRows(run, day)
    const by = new Map<string, number>()
    for (const r of rows) by.set(r.metric, (by.get(r.metric) ?? 0) + 1)
    console.log('\nassembled snapshot rows by metric:', Object.fromEntries(by))
    for (const m of ['wau', 'mau']) console.log(m, '=', rows.find(r => r.metric === m)?.value)
  }
  console.log(`\n${failed === 0 ? 'All queries ran.' : failed + ' quer' + (failed === 1 ? 'y' : 'ies') + ' failed — see above.'}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error(String(e)); process.exit(1) })
