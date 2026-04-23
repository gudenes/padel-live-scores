// src/app/api/ops/tournament-fip-twin/route.ts
//
// GET /api/ops/tournament-fip-twin?tournament_id=X
//
// For a padelapi-sourced tournament with no `fip_id`, find the
// padelgod-discovered FIP twin row (if any). Answers:
// "Can we enable FIP PDF seeding for this tournament?"
//
// Returns:
//   { twin: null }                                 — no match
//   { twin: { candidate, confidence, reasons } }   — match found
//
// Auth: ops_token cookie.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { findFipTwin, type TournamentLike } from '@/lib/fip-twin-matcher'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournament_id')
  if (!tournamentId) {
    return Response.json({ error: 'tournament_id is required' }, { status: 400 })
  }

  // Fetch the target row
  const { data: target, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, slug, fip_id, padelapi_id, source, level, country, starts_at')
    .eq('id', tournamentId)
    .maybeSingle()
  if (tErr) {
    return Response.json({ error: `tournaments read failed: ${tErr.message}` }, { status: 500 })
  }
  if (!target) {
    return Response.json({ error: 'tournament not found' }, { status: 404 })
  }

  // Short-circuit: already has fip_id.
  if (target.fip_id) {
    return Response.json({ twin: null, alreadyLinked: true, fip_id: target.fip_id })
  }

  // Fetch candidate pool — FIP-sourced rows with fip_id set, within a
  // broad year window to avoid pulling all history. We narrow to the
  // target's year ± 1 when starts_at is known.
  const year = target.starts_at ? new Date(target.starts_at).getUTCFullYear() : null

  let query = supabase
    .from('tournaments')
    .select('id, name, slug, fip_id, padelapi_id, source, level, country, starts_at')
    .eq('source', 'fip')
    .not('fip_id', 'is', null)

  if (year !== null) {
    // Candidate slug/fip_id usually ends with `-YYYY`, so filter slug
    // contains year when we know it. Gives us a tighter pool without
    // sacrificing recall.
    query = query.ilike('slug', `%${year}%`)
  }

  const { data: pool, error: poolErr } = await query.limit(500)
  if (poolErr) {
    return Response.json({ error: `pool read failed: ${poolErr.message}` }, { status: 500 })
  }

  const twin = findFipTwin(target as TournamentLike, (pool ?? []) as TournamentLike[])
  return Response.json({ target, twin, poolSize: pool?.length ?? 0 })
}
