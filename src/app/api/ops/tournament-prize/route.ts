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

type PatchInput = {
  tournamentId: string
  prizeMoneyEur: number | null
}

type ValidationResult =
  | { ok: true; value: PatchInput }
  | { ok: false; reason: string }

export function validatePatchInput(body: unknown): ValidationResult {
  if (body == null || typeof body !== 'object') {
    return { ok: false, reason: 'body must be a JSON object' }
  }
  const b = body as Record<string, unknown>

  if (typeof b.tournamentId !== 'string' || b.tournamentId.length === 0) {
    return { ok: false, reason: 'tournamentId must be a non-empty string' }
  }

  const p = b.prizeMoneyEur
  if (p === null) {
    return { ok: true, value: { tournamentId: b.tournamentId, prizeMoneyEur: null } }
  }
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 0) {
    return { ok: false, reason: 'prizeMoneyEur must be null or a non-negative integer' }
  }
  return { ok: true, value: { tournamentId: b.tournamentId, prizeMoneyEur: p } }
}

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
