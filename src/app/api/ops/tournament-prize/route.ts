// PATCH endpoint: manually set tournaments.prize_money_eur on one row.
//
// Used by the ops dashboard's TournamentExplorerTab when the automated
// backfill (scripts/backfill-prize-money-eur.ts) couldn't parse a value
// or operator wants to override a wrong scrape.
//
// Sets prize_money_eur_source = 'manual' so provenance is preserved.
//
// Auth: ops_token cookie via checkOpsAuth (same as other /api/ops/* routes).

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
}

import { validatePatchInput } from './validation'

export async function PATCH(req: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const v = validatePatchInput(body)
  if (!v.ok) return Response.json({ error: v.reason }, { status: 400 })

  const supabase = getSupabase()
  const { error } = await supabase
    .from('tournaments')
    .update({
      prize_money_eur: v.value.prizeMoneyEur,
      prize_money_eur_source: v.value.prizeMoneyEur === null ? null : 'manual',
    })
    .eq('id', v.value.tournamentId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, tournamentId: v.value.tournamentId, prizeMoneyEur: v.value.prizeMoneyEur })
}
