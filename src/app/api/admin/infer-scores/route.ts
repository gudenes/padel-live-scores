// src/app/api/admin/infer-scores/route.ts
// Historical backfill: runs score inference on ALL finished matches with incomplete data.
// No date limit — catches everything the 7-day rolling inferBatch in the scores cron missed.
//
// Also sweeps for finished matches missing winner_pair (even when all sets have scores).
//
// Usage:
//   GET /api/admin/infer-scores                — dry-run: count matches that need repair
//   GET /api/admin/infer-scores?run=true        — run inference + winner repair

import { createClient } from '@supabase/supabase-js'
import { inferFinalScore, inferWinnerPair } from '@/lib/score-inference'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60

export async function GET(request: Request) {
  const url = new URL(request.url)
  const run = url.searchParams.get('run') === 'true'

  // ── 1. Finished matches with null set_score (need score inference) ──
  const { data: nullScoreSets, error: e1 } = await supabase
    .from('sets')
    .select('match_id, matches!inner(id, status)')
    .is('set_score', null)
    .or('score_source.is.null,score_source.neq.api')
    .eq('matches.status', 'finished')
    .limit(500)

  if (e1) return Response.json({ error: e1.message }, { status: 500 })

  const needsScoreInference = [...new Set((nullScoreSets ?? []).map((r: any) => r.match_id))]

  // ── 2. Finished matches missing winner_pair (need winner inference) ──
  const { data: noWinner, error: e2 } = await supabase
    .from('matches')
    .select('id')
    .in('status', ['finished', 'retired', 'walkover'])
    .is('winner_pair', null)
    .limit(500)

  if (e2) return Response.json({ error: e2.message }, { status: 500 })

  const needsWinnerInference = (noWinner ?? []).map((r: any) => r.id)
  // Exclude matches already in the score-inference queue (inferFinalScore calls inferWinnerPair)
  const winnerOnly = needsWinnerInference.filter((id: string) => !needsScoreInference.includes(id))

  if (!run) {
    return Response.json({
      mode: 'dry-run',
      needsScoreInference: needsScoreInference.length,
      needsWinnerOnly: winnerOnly.length,
      total: needsScoreInference.length + winnerOnly.length,
      message: 'Pass ?run=true to execute',
    })
  }

  // ── Execute ──
  let scoreInferred = 0
  let scoreSkipped = 0
  let winnersInferred = 0
  const errors: string[] = []

  // Phase 1: Score inference (also triggers winner inference internally)
  for (const matchId of needsScoreInference) {
    try {
      const result = await inferFinalScore(supabase, matchId)
      if (result.action === 'inferred') scoreInferred++
      else scoreSkipped++
    } catch (err) {
      errors.push(`score ${matchId}: ${err}`)
    }
  }

  // Phase 2: Winner-only inference (matches with complete sets but no winner)
  for (const matchId of winnerOnly) {
    try {
      const winner = await inferWinnerPair(supabase, matchId)
      if (winner) winnersInferred++
    } catch (err) {
      errors.push(`winner ${matchId}: ${err}`)
    }
  }

  return Response.json({
    scoreInferred,
    scoreSkipped,
    winnersInferred,
    errors: errors.slice(0, 50),
    totalErrors: errors.length,
  })
}
