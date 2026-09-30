// apps/ops/scripts/posthog-compare-identity.ts
// Read-only diagnostic: do the Growth retention/active-user numbers change if
// visitors are counted by distinct_id (stable browser id) instead of person_id?
// With person_profiles:'identified_only', anonymous web visitors may not get a
// stable person_id, which would make returning visitors look brand new.
// Writes NOTHING. Run from apps/ops:
//   POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=... npx tsx scripts/posthog-compare-identity.ts [YYYY-MM-DD]

import { hogqlRunnerFromEnv } from '../src/lib/posthog/hogql'
import { q, parseRetention } from '../src/lib/growth/posthog-metrics'
import { buildRetentionMatrix, weightedRetention } from '../src/lib/growth/growth-compute'

const day = process.argv[2] ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const PV = `event = '$pageview'`
const swap = (sql: string) => sql.replaceAll('person_id', 'distinct_id')
const n = (x: unknown) => Number(x ?? 0)

async function main() {
  const run = hogqlRunnerFromEnv()
  console.log(`\nIdentity comparison for ${day} (read-only)\n`)

  for (const [label, transform] of [['person_id', (s: string) => s], ['distinct_id', swap]] as const) {
    const [wau, mau, sizes, cells] = await Promise.all([
      run(transform(q.trailingActive(day, 7))),
      run(transform(q.trailingActive(day, 30))),
      run(transform(q.cohortSizes(day))),
      run(transform(q.retention(day))),
    ])
    const rows = parseRetention(day, sizes as unknown[][], cells as unknown[][])
    const matrix = buildRetentionMatrix(rows, day)
    const w = (k: number) => weightedRetention(matrix, k)
    console.log(`${label.padEnd(12)} WAU=${n((wau[0] as unknown[])[0])}  MAU=${n((mau[0] as unknown[])[0])}  ` +
      `W1=${w(1)}%  W2=${w(2)}%  W3=${w(3)}%  W4=${w(4)}%`)
  }

  // Direct check: of visitors seen in the last 30 days, how many were active on 2+ different days?
  for (const id of ['person_id', 'distinct_id']) {
    const rows = await run(`
      select count() as visitors, countIf(days >= 2) as returning from (
        select ${id}, count(distinct toDate(timestamp)) as days
          from events
         where ${PV}
           and toDate(timestamp) > toDate('${day}') - 30 and toDate(timestamp) <= toDate('${day}')
         group by ${id})`)
    const [v, r] = (rows[0] as unknown[]).map(n)
    console.log(`${id.padEnd(12)} visitors(30d)=${v}  seen on 2+ days=${r}  (${v ? Math.round((r / v) * 1000) / 10 : 0}%)`)
  }

  // Are anonymous events tied to a person profile, and is the browser id stable across days?
  const prof = await run(`
    select countIf(person.properties.email != '' or event = '$identify') as identified_events,
           count() as pageviews,
           count(distinct distinct_id) as distinct_ids,
           count(distinct person_id) as person_ids
      from events
     where ${PV} and timestamp > now() - interval 30 day`)
  console.log('\npageview sample (30d):', JSON.stringify(prof[0]))

  const top = await run(`
    select coalesce(nullif(toString(properties.$browser), ''), '?') as browser, count(distinct distinct_id) as ids
      from events where ${PV} and timestamp > now() - interval 30 day group by browser order by ids desc limit 6`)
  console.log('distinct_ids by browser (30d):', JSON.stringify(top))
}

main().catch(e => { console.error(String(e)); process.exit(1) })
