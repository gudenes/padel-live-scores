// apps/ops/src/lib/growth/posthog-metrics.ts
// HogQL query builders + result parsers for the Growth snapshot. Everything
// takes an injectable runner so it is unit-testable without PostHog.
//
// Known limitations (surface in the UI, see GrowthPosthogPanels):
//  - Native iOS/Android run PostHog in memory mode (src/lib/analytics-init.ts),
//    so each native session is a new anonymous person: native traffic inflates
//    DAU/visitors and cannot show retention. Web + installed PWA are accurate.

import type { HogqlRunner } from '@/lib/posthog/hogql'

export interface SnapshotRow {
  day: string
  metric: string
  dimension: string
  value: number
}

/**
 * "Active" for retention = a pageview on a product surface, not just landing
 * on the home page. Tweak here to change the definition everywhere.
 */
export const ACTIVE_PATH_REGEX = '^/((en|es|pt|it|fr)/)?(matches|match|tournaments|ranking|player|feed)'

/**
 * Logged-in users: after posthog.identify the distinct_id is the Supabase account id
 * (UUIDv4). PostHog's own anonymous browser ids are UUIDv7, so the version digit
 * (first char of the 3rd group) separates the two.
 */
export const ACCOUNT_ID_REGEX = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const assertDay = (d: string) => {
  if (!DAY_RE.test(d)) throw new Error(`invalid day: ${d}`)
  return d
}

const PV = `event = '$pageview'`

export const q = {
  /** Distinct persons per day over the last `days` days up to `day`. */
  dauSeries: (day: string, days = 30) => `
    select toString(toDate(timestamp)) as d, count(distinct person_id) as n
      from events
     where ${PV}
       and toDate(timestamp) > toDate('${assertDay(day)}') - ${days}
       and toDate(timestamp) <= toDate('${day}')
     group by d order by d`,

  /** Distinct persons in the trailing `span` days ending at `day`. */
  trailingActive: (day: string, span: number) => `
    select count(distinct person_id)
      from events
     where ${PV}
       and toDate(timestamp) > toDate('${assertDay(day)}') - ${span}
       and toDate(timestamp) <= toDate('${day}')`,

  referrers: (day: string) => `
    select coalesce(nullif(toString(properties.$referring_domain), ''), '$direct') as ref,
           coalesce(toString(properties.utm_source), '') as utm,
           count(distinct person_id) as n
      from events
     where ${PV}
       and toDate(timestamp) > toDate('${assertDay(day)}') - 30
       and toDate(timestamp) <= toDate('${day}')
     group by ref, utm
     order by n desc
     limit 300`,

  countries: (day: string) => `
    select coalesce(toString(properties.$geoip_country_code), '??') as c,
           count(distinct person_id) as n
      from events
     where ${PV}
       and toDate(timestamp) > toDate('${assertDay(day)}') - 30
       and toDate(timestamp) <= toDate('${day}')
     group by c order by n desc limit 12`,

  /** (cohort week, weeks later, retained persons) + cohort sizes via n = -1. */
  retention: (day: string, lookbackDays = 84) => `
    select toString(f.cohort) as cohort,
           dateDiff('week', f.cohort, a.wk) as n,
           count(distinct f.person_id) as persons
      from (
        select person_id, toStartOfWeek(min(timestamp), 1) as cohort
          from events
         where ${PV}
           and toDate(timestamp) > toDate('${assertDay(day)}') - ${lookbackDays}
           and toDate(timestamp) <= toDate('${day}')
         group by person_id
      ) as f
      join (
        select distinct person_id, toStartOfWeek(timestamp, 1) as wk
          from events
         where ${PV}
           and match(toString(properties.$pathname), '${ACTIVE_PATH_REGEX}')
           and toDate(timestamp) > toDate('${day}') - ${lookbackDays}
           and toDate(timestamp) <= toDate('${day}')
      ) as a on a.person_id = f.person_id
     where dateDiff('week', f.cohort, a.wk) >= 0
     group by cohort, n
     order by cohort, n`,

  /** Logged-in users seen in the 30 days ending `day`, and how many came back on 2+ days. */
  loggedIn: (day: string) => `
    select count() as users, countIf(days >= 2) as returning from (
      select distinct_id, count(distinct toDate(timestamp)) as days
        from events
       where ${PV}
         and match(distinct_id, '${ACCOUNT_ID_REGEX}')
         and toDate(timestamp) > toDate('${assertDay(day)}') - 30
         and toDate(timestamp) <= toDate('${day}')
       group by distinct_id
    )`,

  cohortSizes: (day: string, lookbackDays = 84) => `
    select toString(cohort) as cohort, count() as size from (
      select person_id, toStartOfWeek(min(timestamp), 1) as cohort
        from events
       where ${PV}
         and toDate(timestamp) > toDate('${assertDay(day)}') - ${lookbackDays}
         and toDate(timestamp) <= toDate('${day}')
       group by person_id
    ) group by cohort order by cohort`,
}

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu|startpage)\./i
const SOCIAL = /(^|\.)(instagram|facebook|fb|t\.co|twitter|x\.com|tiktok|youtube|youtu\.be|reddit|linkedin|whatsapp|telegram|threads)\b/i

export type Channel = 'Organic search' | 'Direct' | 'Social' | 'Referral'

/** utm_source wins when present (campaign links), else the referring domain. */
export function classifyChannel(referrer: string, utm = ''): Channel {
  const probe = (utm || referrer).trim()
  if (!probe || probe === '$direct') return 'Direct'
  if (SEARCH.test(probe) || /^(google|bing|duckduckgo)$/i.test(probe)) return 'Organic search'
  if (SOCIAL.test(probe) || /^(ig|instagram|facebook|tiktok|twitter|x|youtube)$/i.test(probe)) return 'Social'
  return 'Referral'
}

const num = (v: unknown) => Number(v ?? 0) || 0
const day10 = (v: unknown) => String(v).slice(0, 10)

export function parseDauSeries(rows: unknown[][]): SnapshotRow[] {
  return rows.map(r => ({ day: day10(r[0]), metric: 'dau', dimension: '', value: num(r[1]) }))
}

export function parseChannels(day: string, rows: unknown[][]): SnapshotRow[] {
  const totals = new Map<Channel, number>()
  for (const r of rows) {
    const ch = classifyChannel(String(r[0] ?? ''), String(r[1] ?? ''))
    totals.set(ch, (totals.get(ch) ?? 0) + num(r[2]))
  }
  return [...totals].map(([dimension, value]) => ({ day, metric: 'channel', dimension, value }))
}

export function parseCountries(day: string, rows: unknown[][]): SnapshotRow[] {
  return rows.map(r => ({ day, metric: 'country', dimension: String(r[0]), value: num(r[1]) }))
}

export function parseRetention(day: string, sizes: unknown[][], cells: unknown[][]): SnapshotRow[] {
  return [
    ...sizes.map(r => ({ day, metric: 'retention_cohort', dimension: day10(r[0]), value: num(r[1]) })),
    ...cells.map(r => ({ day, metric: 'retention', dimension: `${day10(r[0])}:${num(r[1])}`, value: num(r[2]) })),
  ]
}

export function parseLoggedIn(day: string, rows: unknown[][]): SnapshotRow[] {
  const r = (rows[0] ?? []) as unknown[]
  return [
    { day, metric: 'logged_in_active', dimension: '', value: num(r[0]) },
    { day, metric: 'logged_in_returning', dimension: '', value: num(r[1]) },
  ]
}

/** Runs every PostHog query for `day` (a complete UTC day) and returns rows to upsert. */
export async function collectPosthogRows(run: HogqlRunner, day: string): Promise<SnapshotRow[]> {
  const [dauRows, wauRows, mauRows, refRows, ctryRows, retRows, sizeRows, loggedInRows] = await Promise.all([
    run(q.dauSeries(day)),
    run(q.trailingActive(day, 7)),
    run(q.trailingActive(day, 30)),
    run(q.referrers(day)),
    run(q.countries(day)),
    run(q.retention(day)),
    run(q.cohortSizes(day)),
    run(q.loggedIn(day)),
  ])
  return [
    ...parseDauSeries(dauRows as unknown[][]),
    { day, metric: 'wau', dimension: '', value: num((wauRows[0] as unknown[])?.[0]) },
    { day, metric: 'mau', dimension: '', value: num((mauRows[0] as unknown[])?.[0]) },
    ...parseChannels(day, refRows as unknown[][]),
    ...parseCountries(day, ctryRows as unknown[][]),
    ...parseRetention(day, sizeRows as unknown[][], retRows as unknown[][]),
    ...parseLoggedIn(day, loggedInRows as unknown[][]),
  ]
}
