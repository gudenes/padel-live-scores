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

  // 2. Find matches in scope. Note: DB status column has 'ended', 'retired',
  // 'walkover' as final states alongside 'finished'. normaliseStatus() folds
  // them all into 'finished', so we must fetch all of them.
  const wantedStatuses = scope === 'live'
    ? ['live']
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
  const matches = (matchData ?? []) as unknown as (MatchRow & { updated_at: string | null })[]
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

  // 5. Build cards
  const allCards: LiveCard[] = matches.map(m => buildLiveCard(
    m,
    tournamentNames.get(m.tournament_id) ?? '',
    setsByMatch.get(m.id) ?? [],
    pointsByMatch.get(m.id) ?? [],
  ))

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
