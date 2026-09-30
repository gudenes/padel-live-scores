// apps/ops/src/lib/growth/growth-queries.ts
// Supabase reads for the Growth & Adoption page. Thin wrappers around pgPool.
// PostHog-backed metrics (DAU/MAU, funnel, retention) land in a later phase.

import { pgPool } from '@/lib/db'
import type { DayCount } from './growth-compute'

/** Signups per UTC day for the last `days` days (sparse — use fillDaily). */
export async function getDailySignups(days: number): Promise<DayCount[]> {
  const { rows } = await pgPool().query<DayCount>(
    `select (created_at at time zone 'utc')::date::text as day, count(*)::int as n
       from public.profiles
      where created_at >= (now() at time zone 'utc')::date - $1::int
      group by 1
      order by 1`,
    [days],
  )
  return rows
}

export async function getTotalUsers(): Promise<number> {
  const { rows } = await pgPool().query<{ n: number }>(
    `select count(*)::int as n from public.profiles`,
  )
  return rows[0]?.n ?? 0
}

/** Signups in the last `days` days grouped by captured signup locale. */
export async function getSignupLocales(days: number): Promise<Array<{ locale: string; n: number }>> {
  const { rows } = await pgPool().query<{ locale: string; n: number }>(
    `select coalesce(locale, 'unknown') as locale, count(*)::int as n
       from public.profiles
      where created_at >= now() - ($1::int * interval '1 day')
      group by 1
      order by 2 desc`,
    [days],
  )
  return rows
}

export interface PushStats {
  /** distinct users with ≥1 web-push subscription, all time */
  usersWithPush: number
  /** distinct users whose first subscription was in the last `days` */
  newCurrent: number
  /** ... in the `days` before that */
  newPrior: number
}

/** Web-push only (push_subscriptions). Native FCM opt-ins are not counted here. */
export async function getPushStats(days: number): Promise<PushStats> {
  const { rows } = await pgPool().query<{ total: number; cur: number; prior: number }>(
    `with first_sub as (
       select user_id, min(created_at) as first_at
         from public.push_subscriptions
        group by user_id
     )
     select count(*)::int as total,
            count(*) filter (where first_at >= now() - ($1::int * interval '1 day'))::int as cur,
            count(*) filter (
              where first_at <  now() - ($1::int * interval '1 day')
                and first_at >= now() - (2 * $1::int * interval '1 day')
            )::int as prior
       from first_sub`,
    [days],
  )
  const r = rows[0]
  return { usersWithPush: r?.total ?? 0, newCurrent: r?.cur ?? 0, newPrior: r?.prior ?? 0 }
}
