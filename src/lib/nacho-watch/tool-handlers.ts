// src/lib/nacho-watch/tool-handlers.ts
// Executes NachoWatch tools — DB queries, HTTP pings, data checks.
// Every handler returns a JSON string (Claude parses it).
// Handlers never throw — they return { error: "message" } on failure.

import { createServerClient } from '@/lib/supabase'

// ── Tool dispatcher ─────────────────────────────────────────────
export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'check_relay_health':
        return await checkRelayHealth()
      case 'get_live_matches':
        return await getLiveMatches(input)
      case 'get_cron_status':
        return await getCronStatus(input)
      case 'get_stale_matches':
        return await getStaleMatches(input)
      case 'get_data_quality':
        return await getDataQuality(input)
      case 'get_rate_limit_info':
        return await getRateLimitInfo()
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
  }
}

// ── check_relay_health ──────────────────────────────────────────
async function checkRelayHealth(): Promise<string> {
  const relayUrl = process.env.RELAY_URL
  if (!relayUrl) return JSON.stringify({ error: 'RELAY_URL not configured' })

  try {
    const res = await fetch(`${relayUrl}/health`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return JSON.stringify({ status: 'unreachable', httpStatus: res.status })
    const data = await res.json()
    return JSON.stringify({
      status: 'reachable',
      pusherState: data.pusherState ?? 'unknown',
      activeChannels: data.activeChannels ?? 0,
      channelList: (data.channels ?? []).slice(0, 10),
      uptimeSeconds: Math.round(data.uptime ?? 0),
      uptimeHuman: formatUptime(data.uptime ?? 0),
    })
  } catch {
    return JSON.stringify({ status: 'unreachable', error: 'Connection timed out or refused' })
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── get_live_matches ────────────────────────────────────────────
async function getLiveMatches(input: Record<string, unknown>): Promise<string> {
  const supabase = createServerClient()
  let query = supabase
    .from('matches')
    .select(`
      id, status, category, round, court, updated_at,
      tournament:tournaments(name),
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('status', 'live')
    .order('updated_at', { ascending: false })

  if (input.category && input.category !== 'all') {
    query = query.eq('category', input.category as string)
  }

  const { data, error } = await query.limit(20)
  if (error) return JSON.stringify({ error: error.message })

  // Also get the latest set scores for each match
  const matches = data ?? []
  const matchIds = matches.map((m: any) => m.id)

  let sets: any[] = []
  if (matchIds.length > 0) {
    const { data: setData } = await supabase
      .from('sets')
      .select('match_id, set_number, pair1_games, pair2_games, is_current')
      .in('match_id', matchIds)
      .order('set_number', { ascending: true })
    sets = setData ?? []
  }

  const setsByMatch = new Map<string, any[]>()
  for (const s of sets) {
    const arr = setsByMatch.get(s.match_id) ?? []
    arr.push(s)
    setsByMatch.set(s.match_id, arr)
  }

  return JSON.stringify({
    count: matches.length,
    matches: matches.map((m: any) => ({
      id: m.id,
      category: m.category,
      round: m.round,
      court: m.court,
      tournament: m.tournament?.name ?? 'Unknown',
      pair1: [m.pair1_player1?.name, m.pair1_player2?.name].filter(Boolean).join(' / ') || 'TBD',
      pair2: [m.pair2_player1?.name, m.pair2_player2?.name].filter(Boolean).join(' / ') || 'TBD',
      sets: (setsByMatch.get(m.id) ?? []).map((s: any) => `${s.pair1_games}-${s.pair2_games}`),
      lastUpdate: m.updated_at,
      minutesSinceUpdate: Math.round((Date.now() - new Date(m.updated_at).getTime()) / 60000),
    })),
  })
}

// ── get_cron_status ─────────────────────────────────────────────
async function getCronStatus(input: Record<string, unknown>): Promise<string> {
  const supabase = createServerClient()
  const hours = (input.hours as number) || 24
  const since = new Date(Date.now() - hours * 3600_000).toISOString()

  let query = supabase
    .from('ops_events')
    .select('source, status, started_at, finished_at, duration_ms, error_message, meta')
    .gte('started_at', since)
    .order('started_at', { ascending: false })

  if (input.source) {
    query = query.eq('source', input.source as string)
  }

  const { data, error } = await query.limit(50)
  if (error) return JSON.stringify({ error: error.message })

  const events = data ?? []

  // Group by source and get latest + stats
  const bySource = new Map<string, any[]>()
  for (const e of events) {
    const arr = bySource.get(e.source) ?? []
    arr.push(e)
    bySource.set(e.source, arr)
  }

  const summary = Array.from(bySource.entries()).map(([source, runs]) => {
    const latest = runs[0]
    const failures = runs.filter((r: any) => r.status === 'error')
    const avgDuration = Math.round(runs.reduce((sum: number, r: any) => sum + (r.duration_ms ?? 0), 0) / runs.length)
    return {
      source,
      totalRuns: runs.length,
      failures: failures.length,
      successRate: `${Math.round(((runs.length - failures.length) / runs.length) * 100)}%`,
      avgDurationMs: avgDuration,
      latest: {
        status: latest.status,
        startedAt: latest.started_at,
        durationMs: latest.duration_ms,
        error: latest.error_message ?? null,
        meta: latest.meta ?? null,
      },
    }
  })

  return JSON.stringify({ hours, totalEvents: events.length, sources: summary })
}

// ── get_stale_matches ───────────────────────────────────────────
async function getStaleMatches(input: Record<string, unknown>): Promise<string> {
  const supabase = createServerClient()
  const thresholdMin = (input.threshold_minutes as number) || 30
  const cutoff = new Date(Date.now() - thresholdMin * 60000).toISOString()

  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, status, category, round, updated_at,
      tournament:tournaments(name),
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name)
    `)
    .eq('status', 'live')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(20)

  if (error) return JSON.stringify({ error: error.message })

  const stale = data ?? []
  return JSON.stringify({
    count: stale.length,
    thresholdMinutes: thresholdMin,
    matches: stale.map((m: any) => ({
      id: m.id,
      category: m.category,
      round: m.round,
      tournament: m.tournament?.name ?? 'Unknown',
      pair1: m.pair1_player1?.name ?? 'TBD',
      pair2: m.pair2_player1?.name ?? 'TBD',
      lastUpdate: m.updated_at,
      minutesStale: Math.round((Date.now() - new Date(m.updated_at).getTime()) / 60000),
    })),
  })
}

// ── get_data_quality ────────────────────────────────────────────
async function getDataQuality(input: Record<string, unknown>): Promise<string> {
  const supabase = createServerClient()

  // Matches with missing player IDs (at least one null among the 4 player FKs)
  let missingPlayersQuery = supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .not('status', 'eq', 'scheduled')
    .or('pair1_player1_id.is.null,pair1_player2_id.is.null,pair2_player1_id.is.null,pair2_player2_id.is.null')

  if (input.tournament_id) {
    missingPlayersQuery = missingPlayersQuery.eq('tournament_id', input.tournament_id as string)
  }

  // Finished matches with no sets
  const noSetsQuery = supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('status', ['finished', 'ended'])
    .is('winner_pair', null)

  // Tournaments with no logo
  const noLogoQuery = supabase
    .from('tournaments')
    .select('id', { count: 'exact', head: true })
    .is('logo_url', null)

  // Players with no avatar
  const noAvatarQuery = supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .is('avatar_url', null)
    .not('ranking', 'is', null) // only ranked players

  const [missingPlayers, noSets, noLogo, noAvatar] = await Promise.all([
    missingPlayersQuery,
    noSetsQuery,
    noLogoQuery,
    noAvatarQuery,
  ])

  return JSON.stringify({
    matchesMissingPlayers: missingPlayers.count ?? 0,
    finishedMatchesNoWinner: noSets.count ?? 0,
    tournamentsNoLogo: noLogo.count ?? 0,
    rankedPlayersNoAvatar: noAvatar.count ?? 0,
  })
}

// ── get_rate_limit_info ─────────────────────────────────────────
async function getRateLimitInfo(): Promise<string> {
  const supabase = createServerClient()

  // Get recent score cron runs to extract rate limit info from meta
  const { data, error } = await supabase
    .from('ops_events')
    .select('started_at, meta, status')
    .eq('source', 'cron:scores')
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) return JSON.stringify({ error: error.message })

  const events = data ?? []
  const skippedRuns = events.filter((e: any) => e.meta?.skipped === true)
  const latestWithLimit = events.find((e: any) => e.meta?.rateLimitRemaining != null)

  // Estimate daily usage from the number of cron runs × avg requests per run
  const runsInLast24h = events.length
  const avgRequests = events
    .filter((e: any) => e.meta?.requestCount != null)
    .map((e: any) => e.meta.requestCount as number)
  const avgPerRun = avgRequests.length > 0
    ? Math.round(avgRequests.reduce((a: number, b: number) => a + b, 0) / avgRequests.length)
    : 0

  return JSON.stringify({
    dailyLimit: 2000,
    estimatedUsedToday: runsInLast24h * avgPerRun,
    latestRateLimitRemaining: latestWithLimit?.meta?.rateLimitRemaining ?? 'unknown',
    skippedRunsInWindow: skippedRuns.length,
    runsChecked: events.length,
    avgRequestsPerRun: avgPerRun,
  })
}
