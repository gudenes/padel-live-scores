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
  const [health, freshness, quality, recentEvents, relay] = await Promise.all([
    fetchHealth(),
    fetchFreshness(),
    fetchQuality(),
    fetchRecentEvents(),
    fetchRelayStatus(),
  ])

  return Response.json({
    health,
    relay,
    freshness,
    quality,
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
  const [matchesRes, pbpRes, tournamentsRes, unresolvedRes] = await Promise.all([
    supabase.from('matches').select('id', { count: 'exact', head: true }),
    supabase.from('matches').select('id', { count: 'exact', head: true }).not('raw_payload', 'is', null),
    supabase.from('tournaments').select('id', { count: 'exact', head: true }),
    supabase.from('players').select('id', { count: 'exact', head: true }).is('external_id', null),
  ])

  // Missing scores: finished matches without winner
  const { count: missingCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('status', ['finished', 'retired'])
    .is('winner_pair', null)

  return {
    total_matches: matchesRes.count ?? 0,
    with_pbp: pbpRes.count ?? 0,
    missing_scores: missingCount ?? 0,
    unresolved_players: unresolvedRes.count ?? 0,
    total_tournaments: tournamentsRes.count ?? 0,
  }
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
