// src/app/ops/api/status/route.ts
// Returns full dashboard payload as JSON. Auth handled by middleware.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const RELAY_URL = process.env.RELAY_URL
const RELAY_SECRET = process.env.RELAY_SECRET

export async function GET() {
  const [health, freshness, quality, recentEvents, relay, ongoing] = await Promise.all([
    fetchHealth(),
    fetchFreshness(),
    fetchQuality(),
    fetchRecentEvents(),
    fetchRelayStatus(),
    fetchOngoing(),
  ])

  return Response.json({
    health,
    relay,
    freshness,
    quality,
    ongoing,
    usage: null, // Vercel Analytics API — deferred to v2
    recent_events: recentEvents,
    fetched_at: new Date().toISOString(),
  })
}

// ── Health: last event per source ──────────────────────────────

async function fetchHealth() {
  const sources = [
    'cron:scores', 'cron:sync', 'cron:sync-matches',
    'cron:rankings', 'cron:articles', 'cron:highlights',
    'cron:fip-tournaments', 'cron:fip-scores',
  ]

  const health: Record<string, any> = {}

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

async function fetchFreshness() {
  const [liveRes, lastUpdateRes, staleRes] = await Promise.all([
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'live'),
    supabase.from('matches').select('id, external_id, updated_at').order('updated_at', { ascending: false }).limit(1).single(),
    supabase.from('matches').select('id, external_id, updated_at').eq('status', 'live').lt('updated_at', new Date(Date.now() - 15 * 60 * 1000).toISOString()),
  ])

  return {
    live_matches: liveRes.count ?? 0,
    last_score_update: lastUpdateRes.data?.updated_at ?? null,
    stale_matches: (staleRes.data ?? []).map(m => ({
      id: m.id,
      external_id: m.external_id,
      updated_at: m.updated_at,
    })),
  }
}

// ── Quality: counts from existing tables ───────────────────────

async function fetchQuality() {
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
    ongoing_live_matches: ongoingMatches.filter(m => m.status === 'live').length,
    ongoing_scheduled_matches: ongoingMatches.filter(m => m.status === 'scheduled').length,
  }
}

// ── Ongoing: per-tournament breakdown ─────────────────────────

async function fetchOngoing() {
  // Fetch all live + scheduled matches with tournament_id and category
  const { data: matches } = await supabase
    .from('matches')
    .select('tournament_id, status, category')
    .in('status', ['live', 'scheduled'])

  if (!matches || matches.length === 0) return []

  // Group by tournament
  const tournamentIds = [...new Set(matches.map(m => m.tournament_id).filter(Boolean))]

  // Fetch tournament names
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, level, country, source, starts_at')
    .in('id', tournamentIds)

  const tournamentMap = new Map((tournaments ?? []).map(t => [t.id, t]))

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
      const t = tournamentMap.get(id)
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

async function fetchRecentEvents() {
  const { data } = await supabase
    .from('ops_events')
    .select('source, status, started_at, duration_ms, meta, error_message')
    .order('started_at', { ascending: false })
    .limit(50)

  return data ?? []
}
