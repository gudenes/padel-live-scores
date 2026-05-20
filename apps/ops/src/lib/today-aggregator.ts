// apps/ops/src/lib/today-aggregator.ts
// Server-side aggregator for the Today page. Six queries against Supabase,
// designed to be cheap enough to poll every 30-60s from the client.
//
// Logic ported from src/app/ops/api/status/route.ts and src/app/api/ops/
// launch-monitor/route.ts in the main app. The original endpoints stay
// in place; this is the canonical Today source under apps/ops/.

import { pgPool } from './db'
import { getNeedsReviewCounts } from './needs-review-counts'

export interface LiveMatchRow {
  matchId: string
  court: string | null
  tournamentName: string | null
  pair1: string
  pair2: string
  setScores: string[]
  startedAt: string | null
  status: 'live' | 'on_court'
}

export interface RequiresAttentionRow {
  key: 'duplicates' | 'unresolvedPlayers' | 'oopChanges' | 'streamMapping'
  label: string
  count: number
  href: string
}

export interface ScheduleBucket {
  hour: string
  matchCount: number
  roundLabels: string[]
}

export interface TodayPayload {
  fetchedAt: string
  kpis: {
    liveMatches: number
    needsReview: number
    oopPending: number
    streamsLive: number
  }
  liveNow: LiveMatchRow[]
  requiresAttention: RequiresAttentionRow[]
  schedule: ScheduleBucket[]
  systemStatus: 'green' | 'yellow' | 'red'
}

const STALE_MATCH_MINUTES = 15

export async function getTodayPayload(): Promise<TodayPayload> {
  const pool = pgPool()

  // 1. Live match count
  const liveCountRes = await pool.query(
    `select count(*)::text as count from public.matches
       where status in ('live', 'on_court')`,
  )
  const liveMatches = parseInt(liveCountRes.rows[0]?.count ?? '0', 10)

  // 2. Live match sample (up to 12 rows; the table caps display at 8)
  const liveRowsRes = await pool.query(
    `select m.id as match_id,
            m.court,
            m.status,
            m.scheduled_at as started_at,
            t.name as tournament_name,
            (select string_agg(set_score, ',') from public.sets s where s.match_id = m.id) as set_scores_csv,
            p1.name as p1_name, p2.name as p2_name, p3.name as p3_name, p4.name as p4_name
       from public.matches m
       left join public.tournaments t on t.id = m.tournament_id
       left join public.players p1 on p1.id = m.pair1_player1_id
       left join public.players p2 on p2.id = m.pair1_player2_id
       left join public.players p3 on p3.id = m.pair2_player1_id
       left join public.players p4 on p4.id = m.pair2_player2_id
      where m.status in ('live', 'on_court')
      order by m.scheduled_at desc nulls last
      limit 12`,
  )
  const liveNow: LiveMatchRow[] = liveRowsRes.rows.map((r) => ({
    matchId: r.match_id as string,
    court: r.court as string | null,
    tournamentName: r.tournament_name as string | null,
    pair1: [r.p1_name, r.p2_name].filter(Boolean).join(' / '),
    pair2: [r.p3_name, r.p4_name].filter(Boolean).join(' / '),
    setScores: (r.set_scores_csv as string | null)?.split(',').filter(Boolean) ?? [],
    startedAt: r.started_at as string | null,
    status: r.status as 'live' | 'on_court',
  }))

  // 3. Today's scheduled count (UTC date for now)
  const scheduledTodayRes = await pool.query(
    `select count(*)::text as count from public.matches
      where status = 'scheduled'
        and scheduled_at::date = current_date`,
  )
  const scheduledToday = parseInt(scheduledTodayRes.rows[0]?.count ?? '0', 10)

  // 4. Today's finished count
  const finishedTodayRes = await pool.query(
    `select count(*)::text as count from public.matches
      where status in ('finished', 'retired', 'walkover')
        and scheduled_at::date = current_date`,
  )
  const finishedToday = parseInt(finishedTodayRes.rows[0]?.count ?? '0', 10)

  // 5. Stale matches (live > 15min, no recent updates)
  const staleRes = await pool.query(
    `select id, padelapi_id as external_id, updated_at
       from public.matches
      where status = 'live'
        and updated_at < now() - interval '${STALE_MATCH_MINUTES} minutes'
      limit 25`,
  )
  const staleCount = staleRes.rows.length

  // 6. Schedule lookahead — group upcoming matches by hour
  const scheduleRes = await pool.query(
    `select date_trunc('hour', scheduled_at) as bucket,
            count(*)::text as match_count,
            string_agg(distinct round, ', ') as round_labels
       from public.matches
      where status = 'scheduled'
        and scheduled_at >= now()
        and scheduled_at < now() + interval '24 hours'
      group by bucket
      order by bucket asc
      limit 12`,
  )
  const schedule: ScheduleBucket[] = scheduleRes.rows.map((r) => {
    const bucket = new Date(r.bucket as string)
    return {
      hour: bucket.toISOString().slice(11, 16),
      matchCount: parseInt(r.match_count as string, 10),
      roundLabels: ((r.round_labels as string | null) ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  })

  // 7. Needs Review counts (delegates to the existing module)
  const reviewCounts = await getNeedsReviewCounts()

  // 8. System status roll-up
  let systemStatus: 'green' | 'yellow' | 'red' = 'green'
  if (staleCount > 0) {
    systemStatus = 'red'
  } else if (reviewCounts.duplicates > 10) {
    systemStatus = 'yellow'
  }

  const requiresAttention: RequiresAttentionRow[] = [
    { key: 'duplicates', label: 'Duplicate Matches', count: reviewCounts.duplicates, href: '/needs-review?type=duplicates' },
    { key: 'unresolvedPlayers', label: 'Unresolved Players', count: 0, href: '/needs-review?type=unresolvedPlayers' },
    { key: 'oopChanges', label: 'OOP Changes Pending', count: 0, href: '/needs-review?type=oopChanges' },
    { key: 'streamMapping', label: 'Awaiting Stream Mapping', count: 0, href: '/needs-review?type=streamMapping' },
  ]

  // Computed but not yet in the payload contract — referenced so unused-var
  // lint doesn't flag them. They feed schedule context in a follow-up.
  void scheduledToday
  void finishedToday

  return {
    fetchedAt: new Date().toISOString(),
    kpis: {
      liveMatches,
      needsReview: reviewCounts.duplicates,
      oopPending: 0,
      streamsLive: 0,
    },
    liveNow,
    requiresAttention,
    schedule,
    systemStatus,
  }
}
