// apps/ops/src/app/api/internal/tournament-name/route.ts
//
// PATCH endpoint: manually override tournaments.name on one row.
//
// Used by the ops dashboard's TournamentExplorerTab when the scraped name
// is wrong (e.g. a FIP WP title that arrived mangled, or an operator wants
// a cleaner public-facing label).
//
// Sets name_source = 'manual' so the automated writers (padelgod
// tournament-discovery, padelapi sync) preserve the edit instead of
// clobbering it on the next run. Passing name=null clears the override
// (name_source → null) and hands ownership back to the auto sources.
//
// Auth: NextAuth session, isOperator required.

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

type PatchInput = {
  tournamentId: string
  name: string | null
}

type ValidationResult =
  | { ok: true; value: PatchInput }
  | { ok: false; reason: string }

const MAX_NAME_LEN = 200

export function validatePatchInput(body: unknown): ValidationResult {
  if (body == null || typeof body !== 'object') {
    return { ok: false, reason: 'body must be a JSON object' }
  }
  const b = body as Record<string, unknown>

  if (typeof b.tournamentId !== 'string' || b.tournamentId.length === 0) {
    return { ok: false, reason: 'tournamentId must be a non-empty string' }
  }

  if (b.name === null) {
    return { ok: true, value: { tournamentId: b.tournamentId, name: null } }
  }
  if (typeof b.name !== 'string') {
    return { ok: false, reason: 'name must be null or a string' }
  }
  const trimmed = b.name.trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: 'name must not be empty (use null to clear the override)' }
  }
  if (trimmed.length > MAX_NAME_LEN) {
    return { ok: false, reason: `name must be at most ${MAX_NAME_LEN} characters` }
  }
  return { ok: true, value: { tournamentId: b.tournamentId, name: trimmed } }
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const v = validatePatchInput(body)
  if (!v.ok) return Response.json({ error: v.reason }, { status: 400 })

  const supabase = serviceClient()

  // Clearing the override: name_source → null. We leave the current name in
  // place; the next automated run is now free to overwrite it.
  if (v.value.name === null) {
    const { error } = await supabase
      .from('tournaments')
      .update({ name_source: null })
      .eq('id', v.value.tournamentId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, tournamentId: v.value.tournamentId, cleared: true })
  }

  const { error } = await supabase
    .from('tournaments')
    .update({ name: v.value.name, name_source: 'manual' })
    .eq('id', v.value.tournamentId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, tournamentId: v.value.tournamentId, name: v.value.name })
}
