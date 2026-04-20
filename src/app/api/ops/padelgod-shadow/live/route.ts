// src/app/api/ops/padelgod-shadow/live/route.ts
// GET side-by-side current set scores (public.sets vs padelgod.shadow_sets)
// for every currently-live / ended match in a tournament.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

type PlayerLite = { id: string; name: string } | null

type MatchRow = {
  id: string
  status: string
  round: string | null
  pair1_player1: PlayerLite
  pair1_player2: PlayerLite
  pair2_player1: PlayerLite
  pair2_player2: PlayerLite
}

type PublicSet = {
  match_id: string
  set_number: number
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  updated_at?: string | null
}

type ShadowSet = {
  match_id: string
  set_number: number
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  updated_at: string
}

function playerName(p: PlayerLite): string | null {
  return p?.name ?? null
}

function latestSet<T extends { set_number: number }>(rows: T[]): T | null {
  if (rows.length === 0) return null
  return rows.reduce((acc, cur) => (cur.set_number > acc.set_number ? cur : acc), rows[0])
}

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')
  if (!tournamentId) {
    return Response.json({ error: 'tournament_id required' }, { status: 400 })
  }

  // 1) Fetch live/ended matches for this tournament + player names
  const { data: matchData, error: matchErr } = await supabase
    .from('matches')
    .select(`
      id, status, round,
      pair1_player1:players!pair1_player1_id(id, name),
      pair1_player2:players!pair1_player2_id(id, name),
      pair2_player1:players!pair2_player1_id(id, name),
      pair2_player2:players!pair2_player2_id(id, name)
    `)
    .eq('tournament_id', tournamentId)
    .in('status', ['live', 'ended'])

  if (matchErr) {
    console.error('[Shadow Live] matches query failed:', matchErr.message)
    return Response.json({ error: matchErr.message }, { status: 500 })
  }

  const matches = (matchData ?? []) as unknown as MatchRow[]
  if (matches.length === 0) {
    return Response.json([])
  }

  const matchIds = matches.map(m => m.id)

  // 2) Fetch all public.sets for these matches
  const { data: publicSetsData, error: psErr } = await supabase
    .from('sets')
    .select('match_id, set_number, set_score, pair1_games, pair2_games, updated_at')
    .in('match_id', matchIds)
  if (psErr) {
    console.error('[Shadow Live] sets query failed:', psErr.message)
    return Response.json({ error: psErr.message }, { status: 500 })
  }
  const publicSets = (publicSetsData ?? []) as PublicSet[]

  // 3) Fetch all padelgod.shadow_sets for these matches
  const { data: shadowSetsData, error: ssErr } = await supabase
    .schema('padelgod')
    .from('shadow_sets')
    .select('match_id, set_number, set_score, pair1_games, pair2_games, updated_at')
    .in('match_id', matchIds)
  if (ssErr) {
    console.error('[Shadow Live] shadow_sets query failed:', ssErr.message)
    return Response.json({ error: ssErr.message }, { status: 500 })
  }
  const shadowSets = (shadowSetsData ?? []) as ShadowSet[]

  // Group by match_id
  const publicByMatch = new Map<string, PublicSet[]>()
  for (const s of publicSets) {
    const arr = publicByMatch.get(s.match_id) ?? []
    arr.push(s)
    publicByMatch.set(s.match_id, arr)
  }
  const shadowByMatch = new Map<string, ShadowSet[]>()
  for (const s of shadowSets) {
    const arr = shadowByMatch.get(s.match_id) ?? []
    arr.push(s)
    shadowByMatch.set(s.match_id, arr)
  }

  const response = matches
    .map(m => {
      const pubLatest = latestSet(publicByMatch.get(m.id) ?? [])
      const shadowLatest = latestSet(shadowByMatch.get(m.id) ?? [])
      if (!pubLatest && !shadowLatest) return null

      const publicSetScore = pubLatest?.set_score ?? null
      const shadowSetScore = shadowLatest?.set_score ?? null
      const publicUpdatedAt = pubLatest?.updated_at ?? null
      const shadowUpdatedAt = shadowLatest?.updated_at ?? null

      let latencyMs: number | null = null
      if (publicUpdatedAt && shadowUpdatedAt) {
        latencyMs = Date.parse(shadowUpdatedAt) - Date.parse(publicUpdatedAt)
      }

      return {
        match_id: m.id,
        status: m.status,
        round: m.round,
        players: [
          playerName(m.pair1_player1),
          playerName(m.pair1_player2),
          playerName(m.pair2_player1),
          playerName(m.pair2_player2),
        ].filter((n): n is string => !!n),
        publicSetScore,
        publicUpdatedAt,
        shadowSetScore,
        shadowUpdatedAt,
        latencyMs,
        agreement: publicSetScore === shadowSetScore,
      }
    })
    .filter(Boolean)

  return Response.json(response)
}
