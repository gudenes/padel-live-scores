// apps/ops/scripts/posthog-registered-users.ts
// Read-only diagnostic: do LOGGED-IN users (distinct_id shaped like an account
// UUID after posthog.identify) show up on multiple days? Separates "tracking is
// losing returning people" from "anonymous traffic really is one-and-done".
// Writes NOTHING. Run from apps/ops:
//   POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=... npx tsx scripts/posthog-registered-users.ts [YYYY-MM-DD]

import { hogqlRunnerFromEnv } from '../src/lib/posthog/hogql'

const day = process.argv[2] ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
// Supabase account ids are UUIDv4; PostHog's own anonymous browser ids are UUIDv7.
// The version digit is the first char of the 3rd group.
const UUID = `match(distinct_id, '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')`
const IDENTIFIED = `distinct_id in (select distinct distinct_id from events where event = '$identify' and ${'toDate(timestamp) > toDate(\''+day+'\') - 30'})`
const WIN = `toDate(timestamp) > toDate('${day}') - 30 and toDate(timestamp) <= toDate('${day}')`

async function main() {
  const run = hogqlRunnerFromEnv()
  console.log(`\nRegistered-user check for ${day} (read-only)\n`)

  const idents = await run(`select count(), count(distinct distinct_id) from events where event = '$identify' and ${WIN}`)
  console.log('$identify events (30d): events / distinct ids =', JSON.stringify(idents[0]))

  const ver = await run(`select substring(distinct_id, 15, 1) as v, count(distinct distinct_id) as ids from events where event = '$pageview' and ${WIN} group by v order by ids desc limit 6`)
  console.log('distinct_ids by UUID version digit (30d):', JSON.stringify(ver))

  for (const [label, cond] of [['logged-in: UUIDv4 account ids', UUID], ['logged-in: ids that fired $identify', IDENTIFIED], ['anonymous (not UUIDv4)', `not ${UUID}`]] as const) {
    const rows = await run(`
      select days, count() as ids from (
        select distinct_id, count(distinct toDate(timestamp)) as days
          from events
         where event = '$pageview' and ${WIN} and ${cond}
         group by distinct_id)
      group by days order by days`)
    const total = rows.reduce((a, r) => a + Number((r as unknown[])[1]), 0)
    const returning = rows.filter(r => Number((r as unknown[])[0]) >= 2).reduce((a, r) => a + Number((r as unknown[])[1]), 0)
    console.log(`\n${label}`)
    console.log(`  visitors(30d)=${total}  seen on 2+ days=${returning}  (${total ? Math.round((returning / total) * 1000) / 10 : 0}%)`)
    console.log('  days-active histogram [days, ids]:', JSON.stringify(rows.slice(0, 12)))
  }

  const wk = await run(`
    select toString(toStartOfWeek(timestamp, 1)) as wk, count(distinct distinct_id) as ids
      from events where event = '$pageview' and ${UUID} and ${WIN} group by wk order by wk`)
  console.log('\nlogged-in ids per week:', JSON.stringify(wk))
}

main().catch(e => { console.error(String(e)); process.exit(1) })
