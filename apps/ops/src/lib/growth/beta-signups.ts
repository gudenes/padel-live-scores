// apps/ops/src/lib/growth/beta-signups.ts
// Aggregate-only stats for the closed-beta signup campaign. Never selects
// names, emails or phone numbers — prediction_beta_signups is service-role only.

import { pgPool } from '@/lib/db'
import type { DayCount } from './growth-compute'

export interface BetaSignupStats {
  total: number
  last24h: number
  withWhatsapp: number
  byDay: DayCount[]
  byLanguage: Array<{ language: string; n: number }>
}

/** null = table not available (undefined_table), so the page shows an empty state. */
export async function getBetaSignupStats(days: number): Promise<BetaSignupStats | null> {
  const pool = pgPool()
  try {
    const [head, byDay, byLanguage] = await Promise.all([
      pool.query<{ total: number; last24h: number; with_whatsapp: number }>(
        `select count(*)::int as total,
                count(*) filter (where created_at > now() - interval '24 hours')::int as last24h,
                count(*) filter (where whatsapp is not null)::int as with_whatsapp
           from public.prediction_beta_signups`,
      ),
      pool.query<DayCount>(
        `select (created_at at time zone 'utc')::date::text as day, count(*)::int as n
           from public.prediction_beta_signups
          where created_at >= (now() at time zone 'utc')::date - $1::int
          group by 1 order by 1`,
        [days],
      ),
      pool.query<{ language: string; n: number }>(
        `select language, count(*)::int as n
           from public.prediction_beta_signups
          group by 1 order by 2 desc`,
      ),
    ])
    const h = head.rows[0]
    return {
      total: h?.total ?? 0,
      last24h: h?.last24h ?? 0,
      withWhatsapp: h?.with_whatsapp ?? 0,
      byDay: byDay.rows,
      byLanguage: byLanguage.rows,
    }
  } catch (err) {
    if ((err as { code?: string })?.code === '42P01') return null
    throw err
  }
}
