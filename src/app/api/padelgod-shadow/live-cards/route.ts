// src/app/api/padelgod-shadow/live-cards/route.ts
// NOTE: intentionally OUTSIDE /api/ops/ so the proxy's ops-cookie gate
// doesn't swallow the unauth scope=live request path. Auth for the
// scope=live+next+recent buckets is enforced in-route via checkOpsAuth().
// GET live match cards for shadow-enabled tournaments.
//
// Scopes:
//   scope=live                  → only status='live' (no auth required)
//   scope=live+next+recent      → live + next 6 upcoming + last 6 finished (requires ops auth)
//
// Optional filter:
//   tournament_id=<uuid>        → restrict to one tournament

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import {
  buildLiveCard,
  LIVE_ACTIVITY_WINDOW_MS,
  type LiveCard,
  type LiveCardsResponse,
  type MatchRow,
  type ShadowPointRow,
  type ShadowSetRow,
} from '@/lib/padelgod-live-cards'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const UPCOMING_LIMIT = 6
const RECENT_LIMIT = 6

// Opt out of static rendering: this route depends on request query params
// AND on current DB state that shouldn't be cached at build time.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') ?? 'live'
  const tournamentId = url.searchParams.get('tournament_id')

  if (scope !== 'live' && scope !== 'live+next+recent') {
    return Response.json({ error: 'invalid scope' }, { status: 400 })
  }

  // Auth gating: anything beyond scope=live requires ops token
  if (scope === 'live+next+recent') {
    const authErr = await checkOpsAuth()
    if (authErr) return authErr
  }

  // 1. Find shadow-enabled tournaments (optionally filtered to one)
  let tournamentsQ = supabase
    .from('tournaments')
    .select('id, name')
    .eq('shadow_enabled', true)
  if (tournamentId) tournamentsQ = tournamentsQ.eq('id', tournamentId)

  const { data: tournaments, error: tErr } = await tournamentsQ
  if (tErr) {
    console.error('[live-cards] tournaments query failed:', tErr.message)
    return Response.json({ error: tErr.message }, { status: 500 })
  }
  if (!tournaments || tournaments.length === 0) {
    const empty: LiveCardsResponse = { observedAt: new Date().toISOString(), matches: [] }
    return Response.json(empty)
  }

  const tournamentNames = new Map<string, string>(tournaments.map(t => [t.id, t.name]))
  const tournamentIds = tournaments.map(t => t.id)

  // 2a. Find matches that padelgod considers ACTIVE (recent shadow point).
  // This is the key insight: for qualifier matches, padelapi.org has no
  // padelapi_id and never promotes status to 'live' — so we must also surface
  // matches with recent shadow_match_points activity, regardless of status.
  const activeSince = new Date(Date.now() - LIVE_ACTIVITY_WINDOW_MS).toISOString()
  const { data: activeRows } = await supabase
    .schema('padelgod')
    .from('shadow_match_points')
    .select('match_id')
    .gt('created_at', activeSince)
  const activeMatchIds = new Set<string>((activeRows ?? []).map(r => r.match_id as string))

  // 2b. Find matches in scope. Note: DB status column has 'ended', 'retired',
  // 'walkover' as final states alongside 'finished'. normaliseStatus() folds
  // them all into 'finished', so we must fetch all of them. Even for
  // scope=live we include 'scheduled' so padelgod-active qualifiers pass.
  const wantedStatuses = scope === 'live'
    ? ['live', 'scheduled']
    : ['live', 'scheduled', 'finished', 'ended', 'retired', 'walkover']

  const { data: matchData, error: mErr } = await supabase
    .from('matches')
    .select(`
      id, tournament_id, status, court, round, scheduled_at, updated_at,
      pair1_player1:players!pair1_player1_id(name, country),
      pair1_player2:players!pair1_player2_id(name, country),
      pair2_player1:players!pair2_player1_id(name, country),
      pair2_player2:players!pair2_player2_id(name, country)
    `)
    .in('tournament_id', tournamentIds)
    .in('status', wantedStatuses)

  if (mErr) {
    console.error('[live-cards] matches query failed:', mErr.message)
    return Response.json({ error: mErr.message }, { status: 500 })
  }
  let matches = (matchData ?? []) as unknown as (MatchRow & { updated_at: string | null })[]

  // For scope=live, drop 'scheduled' matches that are NOT padelgod-active —
  // they were fetched only because they *might* be active, and we don't want
  // to flood the payload with upcoming matches.
  if (scope === 'live') {
    matches = matches.filter(m => m.status === 'live' || activeMatchIds.has(m.id))
  }

  if (matches.length === 0) {
    const empty: LiveCardsResponse = { observedAt: new Date().toISOString(), matches: [] }
    return Response.json(empty)
  }

  const matchIds = matches.map(m => m.id)

  // 3. Fetch shadow sets for these matches
  const { data: setData } = await supabase
    .schema('padelgod')
    .from('shadow_sets')
    .select('match_id, set_number, pair1_games, pair2_games, updated_at')
    .in('match_id', matchIds)
  const shadowSets = (setData ?? []) as ShadowSetRow[]

  // 4. Fetch shadow points for these matches (we'll cap per-match in buildLiveCard)
  const { data: pointData } = await supabase
    .schema('padelgod')
    .from('shadow_match_points')
    .select('match_id, set_number, game_number, point_number, winner_pair, score_after, server_team, is_golden_point, created_at')
    .in('match_id', matchIds)
  const shadowPoints = (pointData ?? []) as ShadowPointRow[]

  // 4b. Fetch latest OOP snapshot rows per (tournament_id, court) to serve
  // as a fallback source of player names when matches.pair*_player*_id FKs
  // are NULL (common for qualifiers padelapi.org never scraped). Keep
  // scope tight: only last 24h, only tournaments we're already returning.
  const oopByKey = new Map<string, { team1_player1_name: string | null; team1_player2_name: string | null; team2_player1_name: string | null; team2_player2_name: string | null }>()
  const { data: oopData } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select('tournament_id, court, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, captured_at')
    .in('tournament_id', tournamentIds)
    .gt('captured_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('captured_at', { ascending: false })
  type OopRow = { tournament_id: string; court: string | null; team1_player1_name: string | null; team1_player2_name: string | null; team2_player1_name: string | null; team2_player2_name: string | null; captured_at: string }
  for (const row of (oopData ?? []) as OopRow[]) {
    if (!row.court) continue
    // Normalise case for robust joining — our matches.court and padelgod's
    // oop_snapshots.court can differ in casing (e.g. 'COURT CBC' vs 'Court Cbc').
    const key = `${row.tournament_id}|${row.court.toUpperCase().trim()}`
    if (!oopByKey.has(key)) oopByKey.set(key, row) // first is newest due to desc order
  }

  const setsByMatch = new Map<string, ShadowSetRow[]>()
  for (const s of shadowSets) {
    const arr = setsByMatch.get(s.match_id) ?? []
    arr.push(s)
    setsByMatch.set(s.match_id, arr)
  }
  const pointsByMatch = new Map<string, ShadowPointRow[]>()
  for (const p of shadowPoints) {
    const arr = pointsByMatch.get(p.match_id) ?? []
    arr.push(p)
    pointsByMatch.set(p.match_id, arr)
  }

  // 5. Build cards. For each match with NULL player FKs, synthesise
  // PlayerLite placeholders from the matching oop_snapshots row before
  // passing to buildLiveCard. Country info isn't in oop_snapshots so we
  // pass it as null.
  const allCards: LiveCard[] = matches.map(m => {
    const needsFallback =
      !m.pair1_player1 && !m.pair1_player2 && !m.pair2_player1 && !m.pair2_player2
    let enrichedMatch = m
    if (needsFallback && m.court) {
      const key = `${m.tournament_id}|${m.court.toUpperCase().trim()}`
      const oop = oopByKey.get(key)
      if (oop) {
        const toPlayer = (name: string | null) =>
          name && name.trim().length > 0
            ? { name: name.trim(), country: null }
            : null
        enrichedMatch = {
          ...m,
          pair1_player1: toPlayer(oop.team1_player1_name),
          pair1_player2: toPlayer(oop.team1_player2_name),
          pair2_player1: toPlayer(oop.team2_player1_name),
          pair2_player2: toPlayer(oop.team2_player2_name),
        }
      }
    }
    return buildLiveCard(
      enrichedMatch,
      tournamentNames.get(m.tournament_id) ?? '',
      setsByMatch.get(m.id) ?? [],
      pointsByMatch.get(m.id) ?? [],
    )
  })

  // 6. Bucket + sort
  const live = allCards.filter(c => c.status === 'live')
  let upcoming: LiveCard[] = []
  let recent: LiveCard[] = []
  if (scope === 'live+next+recent') {
    upcoming = allCards
      .filter(c => c.status === 'scheduled')
      .sort((a, b) => {
        const aT = a.scheduledAt ? Date.parse(a.scheduledAt) : Infinity
        const bT = b.scheduledAt ? Date.parse(b.scheduledAt) : Infinity
        return aT - bT
      })
      .slice(0, UPCOMING_LIMIT)

    // Use updated_at on the raw match row for "recent finished" sort
    const updatedAtById = new Map(matches.map(m => [m.id, m.updated_at ?? '']))
    recent = allCards
      .filter(c => c.status === 'finished')
      .sort((a, b) => (updatedAtById.get(b.id) ?? '').localeCompare(updatedAtById.get(a.id) ?? ''))
      .slice(0, RECENT_LIMIT)
  }

  const body: LiveCardsResponse = {
    observedAt: new Date().toISOString(),
    matches: [...live, ...upcoming, ...recent],
  }
  return Response.json(body)
}
