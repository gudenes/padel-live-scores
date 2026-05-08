// src/app/api/predictions/route.ts
//
// POST: create or update a prediction (upsert on (user_id, match_id))
// GET: list current user's predictions

import { getUserOrFail } from '../user/_auth'
import { isPickWindowOpen, buildPredictionRow } from '@/lib/predictions/server'
import type { Match } from '@/types/match'

export async function POST(request: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { matchId, pair, margin } = (body ?? {}) as {
    matchId?: string; pair?: number; margin?: string
  }
  if (typeof matchId !== 'string' || !matchId) {
    return Response.json({ error: 'matchId_required' }, { status: 400 })
  }
  if (pair !== 1 && pair !== 2) {
    return Response.json({ error: 'pair_must_be_1_or_2' }, { status: 400 })
  }
  if (margin !== '2-0' && margin !== '2-1') {
    return Response.json({ error: 'margin_must_be_2-0_or_2-1' }, { status: 400 })
  }

  // Load the match with player rankings so the probability computation works.
  // Match shape mirrors what computeMatchProbability expects.
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select(`
      id, status, scheduled_at,
      pair1_player1:pair1_player1_id ( id, ranking ),
      pair1_player2:pair1_player2_id ( id, ranking ),
      pair2_player1:pair2_player1_id ( id, ranking ),
      pair2_player2:pair2_player2_id ( id, ranking )
    `)
    .eq('id', matchId)
    .maybeSingle()

  if (matchErr || !match) {
    return Response.json({ error: 'match_not_found' }, { status: 404 })
  }

  if (!isPickWindowOpen(match as unknown as Match, new Date())) {
    return Response.json({ error: 'pick_window_closed' }, { status: 409 })
  }

  const draft = buildPredictionRow(match as unknown as Match, {
    userId: user.id,
    pair: pair as 1 | 2,
    margin: margin as '2-0' | '2-1',
  })

  const { data: row, error: upsertErr } = await supabase
    .from('predictions')
    .upsert(draft, { onConflict: 'user_id,match_id' })
    .select()
    .single()

  if (upsertErr) {
    return Response.json({ error: upsertErr.message }, { status: 500 })
  }
  return Response.json(row, { status: 200 })
}

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data, error: dbErr } = await supabase
    .from('predictions')
    .select('match_id, pair, margin, probability, multiplier, is_fallback, result, reward, resolved_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ items: data ?? [] })
}
