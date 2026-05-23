// apps/ops/src/app/api/internal/ops-status/route.ts
// Returns full dashboard payload as JSON. Shared data source for
// Integration Health (Task 12) and Data Quality (Task 13).
// Auth: operator session required (Rule 1).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const RELAY_URL = process.env.RELAY_URL
const RELAY_SECRET = process.env.RELAY_SECRET

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const [health, freshness, quality, recentEvents, relay, ongoing, cronStats] = await Promise.all([
    fetchHealth(supabase),
    fetchFreshness(supabase),
    fetchQuality(supabase),
    fetchRecentEvents(supabase),
    fetchRelayStatus(),
    fetchOngoing(supabase),
    fetchCronStats(supabase),
  ])

  return NextResponse.json({
    health,
    relay,
    freshness,
    quality,
    ongoing,
    cron_stats: cronStats,
    usage: null, // Vercel Analytics API — deferred to v2
    recent_events: recentEvents,
    fetched_at: new Date().toISOString(),
  })
}

// ── Health: last event per source ──────────────────────────────

async function fetchHealth(supabase: ReturnType<typeof serviceClient>) {
  const sources = [
    'cron:scores', 'cron:sync', 'cron:sync-matches',
    'cron:rankings', 'cron:articles', 'cron:highlights',
    'cron:fip-tournaments', 'cron:fip-scores',
  ]

  const health: Record<string, unknown> = {}

  for (const source of sources) {
    const { data } = await supabase
      .from('ops_events')
      .select('status, started_at, duration_ms, meta, error_message')
      .eq('source', source)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    health[source] = data ?? { status: 'unknown', started_at: null, duration_ms: null, meta: null, error_message: null }
  }

  return health
}

// ── Relay: live fetch from Railway ─────────────────────────────

async function fetchRelayStatus() {
  if (!RELAY_URL || !RELAY_SECRET) {
    return { ok: false, pusher_state: 'unknown', active_channels: 0, uptime: 0 }
  }

  try {
    const res = await fetch(`${RELAY_URL}/health`, {
      headers: { Authorization: `Bearer ${RELAY_SECRET}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
      ok: data.ok === true,
      pusher_state: data.pusherState ?? 'unknown',
      active_channels: data.activeChannels ?? 0,
      uptime: data.uptime ?? 0,
    }
  } catch {
    return { ok: false, pusher_state: 'unreachable', active_channels: 0, uptime: 0 }
  }
}

// ── Freshness: live matches, last update, stale ────────────────

async function fetchFreshness(supabase: ReturnType<typeof serviceClient>) {
  const [liveRes, lastUpdateRes, staleRes] = await Promise.all([
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'live'),
    supabase.from('matches').select('id, external_id, updated_at').order('updated_at', { ascending: false }).limit(1).single(),
    supabase.from('matches').select('id, external_id, updated_at').eq('status', 'live').lt('updated_at', new Date(Date.now() - 15 * 60 * 1000).toISOString()),
  ])

  return {
    live_matches: liveRes.count ?? 0,
    last_score_update: lastUpdateRes.data?.updated_at ?? null,
    stale_matches: (staleRes.data ?? []).map((m: { id: string; external_id: string | null; updated_at: string }) => ({
      id: m.id,
      external_id: m.external_id,
      updated_at: m.updated_at,
    })),
  }
}

// ── Quality: counts from existing tables ───────────────────────

async function fetchQuality(supabase: ReturnType<typeof serviceClient>) {
  const [matchesRes, pbpRes, tournamentsRes, unresolvedRes, missingRes, ongoingRes] = await Promise.all([
    supabase.from('matches').select('id', { count: 'exact', head: true }),
    supabase.from('matches').select('id', { count: 'exact', head: true }).not('raw_payload', 'is', null),
    supabase.from('tournaments').select('id', { count: 'exact', head: true }),
    supabase.from('players').select('id', { count: 'exact', head: true }).is('external_id', null),
    supabase.from('matches').select('id', { count: 'exact', head: true }).in('status', ['finished', 'retired']).is('winner_pair', null),
    // Ongoing events: tournaments with at least one live or scheduled match
    supabase.from('matches').select('tournament_id, status', { count: 'exact', head: false }).in('status', ['live', 'scheduled']),
  ])

  // Aggregate ongoing event stats from match data
  const ongoingMatches = ongoingRes.data ?? []
  const eventMap = new Map<string, { live: number; scheduled: number }>()
  for (const m of ongoingMatches) {
    if (!m.tournament_id) continue
    const entry = eventMap.get(m.tournament_id) ?? { live: 0, scheduled: 0 }
    if (m.status === 'live') entry.live++
    else entry.scheduled++
    eventMap.set(m.tournament_id, entry)
  }

  return {
    total_matches: matchesRes.count ?? 0,
    with_pbp: pbpRes.count ?? 0,
    missing_scores: missingRes.count ?? 0,
    unresolved_players: unresolvedRes.count ?? 0,
    total_tournaments: tournamentsRes.count ?? 0,
    ongoing_events: eventMap.size,
    ongoing_live_matches: ongoingMatches.filter((m: { status: string }) => m.status === 'live').length,
    ongoing_scheduled_matches: ongoingMatches.filter((m: { status: string }) => m.status === 'scheduled').length,
  }
}

// ── Ongoing: per-tournament breakdown ─────────────────────────

async function fetchOngoing(supabase: ReturnType<typeof serviceClient>) {
  // Fetch all live + scheduled matches with tournament_id and category
  const { data: matches } = await supabase
    .from('matches')
    .select('tournament_id, status, category')
    .in('status', ['live', 'scheduled'])

  if (!matches || matches.length === 0) return []

  // Group by tournament
  const tournamentIds = [...new Set(matches.map((m: { tournament_id: string | null }) => m.tournament_id).filter(Boolean))] as string[]

  // Fetch tournament names
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, level, country, source, starts_at')
    .in('id', tournamentIds)

  const tournamentMap = new Map((tournaments ?? []).map((t: { id: string; name: string; level: string | null; country: string | null; source: string | null; starts_at: string | null }) => [t.id, t]))

  // Build per-tournament stats
  const eventStats = new Map<string, { live: number; scheduled: number; finished: number; categories: Set<string> }>()
  for (const m of matches) {
    if (!m.tournament_id) continue
    const entry = eventStats.get(m.tournament_id) ?? { live: 0, scheduled: 0, finished: 0, categories: new Set() }
    if (m.status === 'live') entry.live++
    else if (m.status === 'scheduled') entry.scheduled++
    if (m.category) entry.categories.add(m.category)
    eventStats.set(m.tournament_id, entry)
  }

  // Also count finished matches for these tournaments (for progress)
  const { data: finishedMatches } = await supabase
    .from('matches')
    .select('tournament_id')
    .in('tournament_id', tournamentIds)
    .in('status', ['finished', 'retired'])

  for (const m of finishedMatches ?? []) {
    if (!m.tournament_id) continue
    const entry = eventStats.get(m.tournament_id)
    if (entry) entry.finished++
  }

  return tournamentIds
    .map(id => {
      const t = tournamentMap.get(id) as { name: string; level: string | null; country: string | null; source: string | null; starts_at: string | null } | undefined
      const stats = eventStats.get(id)!
      const total = stats.live + stats.scheduled + stats.finished
      // FIP tournaments in qualifying: started but all MD/WD matches still scheduled
      const isQualifying = t?.source === 'fip'
        && t?.starts_at && new Date(t.starts_at) <= new Date()
        && stats.live === 0 && stats.finished === 0 && stats.scheduled > 0

      return {
        tournament_id: id,
        name: t?.name ?? 'Unknown',
        level: t?.level ?? null,
        country: t?.country ?? null,
        source: t?.source ?? null,
        categories: [...stats.categories],
        live: stats.live,
        scheduled: stats.scheduled,
        finished: stats.finished,
        total,
        qualifying: isQualifying,
      }
    })
    .sort((a, b) => b.live - a.live || b.scheduled - a.scheduled)
}

// ── Recent events log ──────────────────────────────────────────

async function fetchRecentEvents(supabase: ReturnType<typeof serviceClient>) {
  const { data } = await supabase
    .from('ops_events')
    .select('source, status, started_at, duration_ms, meta, error_message')
    .order('started_at', { ascending: false })
    .limit(50)

  return data ?? []
}

// ── Cron stats: run counts + cumulative datapoints ─────────────

async function fetchCronStats(supabase: ReturnType<typeof serviceClient>) {
  // Fetch all ops_events to compute run counts and aggregate datapoints per source
  const { data } = await supabase
    .from('ops_events')
    .select('source, status, meta')

  if (!data) return {}

  const stats: Record<string, { runs: number; ok_runs: number; datapoints: number }> = {}

  for (const evt of data) {
    const s = stats[evt.source] ?? { runs: 0, ok_runs: 0, datapoints: 0 }
    s.runs++
    if (evt.status === 'ok') s.ok_runs++

    // Sum up datapoints from meta based on source type
    if (evt.meta && evt.status === 'ok') {
      const m = evt.meta as Record<string, number>
      switch (evt.source) {
        case 'cron:scores':
          s.datapoints += (m.synced ?? 0)
          break
        case 'cron:sync-matches':
          s.datapoints += (m.matches_synced ?? 0)
          break
        case 'cron:sync':
          s.datapoints += (m.tournaments_synced ?? 0) + (m.players_synced ?? 0)
          break
        case 'cron:rankings':
          s.datapoints += (m.official ?? 0) + (m.race ?? 0)
          break
        case 'cron:articles':
          s.datapoints += (m.new ?? 0)
          break
        case 'cron:highlights':
          s.datapoints += (m.new ?? 0)
          break
        case 'cron:fip-tournaments':
          s.datapoints += (m.upserted ?? 0)
          break
        case 'cron:fip-scores':
          s.datapoints += (m.matches_upserted ?? 0)
          break
      }
    }

    stats[evt.source] = s
  }

  return stats
}
