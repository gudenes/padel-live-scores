// src/app/api/admin/predictions/re-resolve/route.ts
//
// POST /api/admin/predictions/re-resolve?matchId=<uuid>
// Clears resolved_at on all predictions for the match so the next
// resolve-predictions cron tick reclassifies them. Use after fixing
// match data (winner_pair, set scores) post-finish.

import { createServiceClient } from '@/lib/supabase'

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const matchId = url.searchParams.get('matchId')
  if (!matchId) return Response.json({ error: 'matchId_required' }, { status: 400 })

  const supabase = createServiceClient()
  const { error, count } = await supabase
    .from('predictions')
    .update({ resolved_at: null, result: null, reward: null }, { count: 'exact' })
    .eq('match_id', matchId)
    .not('resolved_at', 'is', null)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ cleared: count ?? 0 })
}
