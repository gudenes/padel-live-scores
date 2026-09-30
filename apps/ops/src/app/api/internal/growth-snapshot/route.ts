// apps/ops/src/app/api/internal/growth-snapshot/route.ts
// Daily growth snapshot. Vercel cron 09:45 UTC. Pulls PostHog metrics for the
// last complete UTC day (yesterday), adds Supabase-side funnel steps, and
// UPSERTs into public.growth_snapshots. Idempotent: re-running a day overwrites.
// Manual run:  curl -X POST -H "Authorization: Bearer $CRON_SECRET" <admin>/api/internal/growth-snapshot[?day=YYYY-MM-DD]

import { NextResponse } from 'next/server'
import { pgPool } from '@/lib/db'
import { hogqlRunnerFromEnv, PosthogConfigError } from '@/lib/posthog/hogql'
import { collectPosthogRows, type SnapshotRow } from '@/lib/growth/posthog-metrics'

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

// Vercel crons call GET; same auth applies to both methods.
export const GET = POST

/** Signup → adoption steps for users who signed up in the 30 days ending `day`. */
async function supabaseFunnelRows(day: string): Promise<SnapshotRow[]> {
  const { rows } = await pgPool().query<{ signed_up: number; bookmarked_player: number; push: number }>(
    `with cohort as (
       select id from public.profiles
        where (created_at at time zone 'utc')::date >  $1::date - 30
          and (created_at at time zone 'utc')::date <= $1::date
     )
     select (select count(*) from cohort)::int as signed_up,
            (select count(distinct b.user_id) from public.user_bookmarks b
               join cohort c on c.id = b.user_id where b.bookmark_type = 'player')::int as bookmarked_player,
            (select count(distinct p.user_id) from public.push_subscriptions p
               join cohort c on c.id = p.user_id)::int as push`,
    [day],
  )
  const r = rows[0] ?? { signed_up: 0, bookmarked_player: 0, push: 0 }
  return [
    { day, metric: 'funnel', dimension: 'signed_up', value: r.signed_up },
    { day, metric: 'funnel', dimension: 'bookmarked_player', value: r.bookmarked_player },
    { day, metric: 'funnel', dimension: 'push', value: r.push },
  ]
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const day = new URL(req.url).searchParams.get('day') ?? isoDaysAgo(1)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: 'invalid_day', message: 'day must be YYYY-MM-DD' }, { status: 400 })
  }

  let run
  try {
    run = hogqlRunnerFromEnv()
  } catch (e) {
    if (e instanceof PosthogConfigError) {
      return NextResponse.json({ error: 'posthog_config', message: e.message }, { status: 500 })
    }
    throw e
  }

  let rows: SnapshotRow[]
  try {
    rows = await collectPosthogRows(run, day)
  } catch (e) {
    console.error('[growth-snapshot] PostHog pull failed:', e)
    return NextResponse.json({ error: 'posthog_pull_failed', message: String(e) }, { status: 502 })
  }

  try {
    const mau = rows.find(r => r.metric === 'mau')?.value ?? 0
    rows = [...rows, { day, metric: 'funnel', dimension: 'visitors', value: mau }, ...(await supabaseFunnelRows(day))]

    await pgPool().query(
      `insert into public.growth_snapshots (day, metric, dimension, value)
       select * from unnest($1::date[], $2::text[], $3::text[], $4::numeric[])
       on conflict (day, metric, dimension)
       do update set value = excluded.value, fetched_at = now()`,
      [rows.map(r => r.day), rows.map(r => r.metric), rows.map(r => r.dimension), rows.map(r => r.value)],
    )
  } catch (e) {
    console.error('[growth-snapshot] write failed:', e)
    return NextResponse.json({ error: 'write_failed', message: String(e) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, day, rows: rows.length })
}
