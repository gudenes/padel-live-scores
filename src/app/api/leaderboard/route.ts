// src/app/api/leaderboard/route.ts
//
// GET /api/leaderboard?scope=tournament&tournamentId=<uuid>
// GET /api/leaderboard?scope=season&seasonId=<int>  (seasonId = seasons.external_id)
//
// Returns ranked rows + a `currentUser` envelope so the UI can render the
// "your rank" sticky bottom row without a second roundtrip.

import { auth } from '@/auth'
import { createServiceClient } from '@/lib/supabase'
import { rankRows, type LeaderboardRowInput } from '@/lib/predictions/leaderboard-query'

const PAGE_SIZE = 50

export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope')
  const supabase = createServiceClient()

  // Build the base predictions filter as a list of match IDs in the scope.
  let matchIds: string[]
  if (scope === 'tournament') {
    const tournamentId = url.searchParams.get('tournamentId')
    if (!tournamentId) return Response.json({ error: 'tournamentId_required' }, { status: 400 })
    const { data, error } = await supabase
      .from('matches').select('id').eq('tournament_id', tournamentId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    matchIds = (data ?? []).map(m => m.id)
  } else if (scope === 'season') {
    const seasonId = url.searchParams.get('seasonId')
    if (!seasonId) return Response.json({ error: 'seasonId_required' }, { status: 400 })
    const { data: tourns, error: tErr } = await supabase
      .from('tournaments').select('id').eq('season_external_id', Number(seasonId))
    if (tErr) return Response.json({ error: tErr.message }, { status: 500 })
    const tIds = (tourns ?? []).map(t => t.id)
    if (tIds.length === 0) {
      return Response.json({ rows: [], nextCursor: null, currentUser: { rank: null, row: null } })
    }
    const { data: ms, error: mErr } = await supabase
      .from('matches').select('id').in('tournament_id', tIds)
    if (mErr) return Response.json({ error: mErr.message }, { status: 500 })
    matchIds = (ms ?? []).map(m => m.id)
  } else {
    return Response.json({ error: 'scope_must_be_tournament_or_season' }, { status: 400 })
  }

  if (matchIds.length === 0) {
    return Response.json({ rows: [], nextCursor: null, currentUser: { rank: null, row: null } })
  }

  // Pull all predictions in this scope. For our user counts (<10k actives),
  // doing the aggregate in JS is simpler than building a SQL view.
  // If this becomes a hot path, swap for a Postgres function.
  const { data: preds, error: pErr } = await supabase
    .from('predictions')
    .select('user_id, result, reward, resolved_at, created_at')
    .in('match_id', matchIds)

  if (pErr) return Response.json({ error: pErr.message }, { status: 500 })

  const byUser = new Map<string, {
    picks: number
    resolved: number
    right: number
    guacas: number
    earliest: string
  }>()

  for (const p of preds ?? []) {
    const u = byUser.get(p.user_id) ?? { picks: 0, resolved: 0, right: 0, guacas: 0, earliest: p.created_at }
    u.picks++
    if (p.resolved_at && p.result && p.result !== 'invalidated') {
      u.resolved++
      if (p.result === 'right' || p.result === 'perfect' || p.result === 'upset') u.right++
      u.guacas += p.reward ?? 0
    }
    if (new Date(p.created_at) < new Date(u.earliest)) u.earliest = p.created_at
    byUser.set(p.user_id, u)
  }

  // Hydrate user names + avatars
  const userIds = [...byUser.keys()]
  const { data: users } = await supabase
    .from('users')
    .select('id, name, image')
    .in('id', userIds)
  const userById = new Map((users ?? []).map(u => [u.id, u]))

  const inputs: LeaderboardRowInput[] = userIds.map(uid => {
    const agg = byUser.get(uid)!
    const u = userById.get(uid)
    return {
      userId: uid,
      name: u?.name ?? null,
      avatar: u?.image ?? null,
      picksCount: agg.picks,
      accuracyPct: agg.resolved > 0 ? Math.round((agg.right / agg.resolved) * 100) : 0,
      guacas: agg.guacas,
      earliestPickAt: agg.earliest,
    }
  })

  const ranked = rankRows(inputs)

  // Apply cursor pagination
  const cursorRaw = url.searchParams.get('cursor')
  let startIdx = 0
  if (cursorRaw) {
    const idx = ranked.findIndex(r => r.userId === cursorRaw)
    if (idx >= 0) startIdx = idx + 1
  }
  const pageRows = ranked.slice(startIdx, startIdx + PAGE_SIZE)
  const nextRow = ranked[startIdx + PAGE_SIZE]
  const nextCursor = nextRow ? nextRow.userId : null

  // Hydrate the current user's row regardless of page
  const session = await auth()
  const meId = session?.user?.id ?? null
  const meRow = meId ? ranked.find(r => r.userId === meId) ?? null : null

  return Response.json({
    rows: pageRows,
    nextCursor,
    currentUser: { rank: meRow?.rank ?? null, row: meRow ?? null },
  })
}
