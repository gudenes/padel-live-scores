// src/app/api/cron/resolve-predictions/route.ts
//
// Every 5 min: find finished matches with unresolved picks, classify them,
// write result + reward + resolved_at. Idempotent: already-resolved rows
// are filtered out by the `resolved_at IS NULL` index.

import { createServiceClient } from '@/lib/supabase'
import { classifyResult, computeReward } from '@/lib/predictions/scoring'
import type { Match } from '@/types/match'
import type { Prediction } from '@/lib/predictions/types'

export async function GET(request: Request) {
  // CRON_SECRET gate (Vercel cron always supplies this)
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const startedAt = Date.now()

  // 1. Find distinct match IDs that are finished + have unresolved predictions
  const { data: candidatePicks, error: pErr } = await supabase
    .from('predictions')
    .select('match_id')
    .is('resolved_at', null)

  if (pErr) return Response.json({ error: pErr.message }, { status: 500 })

  const candidateMatchIds = [...new Set((candidatePicks ?? []).map(p => p.match_id))]
  if (candidateMatchIds.length === 0) {
    return Response.json({ resolved: 0, durationMs: Date.now() - startedAt })
  }

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select(`
      id, status, winner_pair,
      pair1_player1:pair1_player1_id ( id ),
      pair1_player2:pair1_player2_id ( id ),
      pair2_player1:pair2_player1_id ( id ),
      pair2_player2:pair2_player2_id ( id ),
      sets ( set_number, pair1_games, pair2_games )
    `)
    .in('id', candidateMatchIds)
    .in('status', ['finished', 'retired', 'walkover'])

  if (mErr) return Response.json({ error: mErr.message }, { status: 500 })

  let resolvedCount = 0
  for (const m of matches ?? []) {
    // Load all unresolved picks for this match
    const { data: picks, error: pickErr } = await supabase
      .from('predictions')
      .select('id, user_id, match_id, pair, margin, probability, multiplier, is_fallback, created_at')
      .eq('match_id', m.id)
      .is('resolved_at', null)

    if (pickErr || !picks) continue

    for (const p of picks) {
      const prediction: Prediction = {
        matchId: p.match_id,
        pair: p.pair as 1 | 2,
        margin: p.margin as '2-0' | '2-1',
        probability: p.probability,
        multiplier: p.multiplier,
        isFallback: p.is_fallback,
        createdAt: p.created_at,
      }
      const classified = classifyResult(prediction, m as unknown as Match)
      if (!classified) continue
      const reward = computeReward(prediction, classified)

      await supabase
        .from('predictions')
        .update({
          result: classified.result,
          reward,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', p.id)

      resolvedCount++
    }
  }

  return Response.json({
    resolved: resolvedCount,
    matchesScanned: matches?.length ?? 0,
    durationMs: Date.now() - startedAt,
  })
}
