// apps/ops/src/app/api/internal/link-fip-id/route.ts
//
// POST /api/internal/link-fip-id
// Body: { targetTournamentId: string, sourceTournamentId: string }
//
// Copies `fip_id` + `slug` from a padelgod-discovered FIP twin row onto a
// target (typically padelapi-sourced) tournament. Does NOT delete or
// archive the twin — that's a separate merge operation.
//
// Ported from src/app/api/ops/link-fip-id/route.ts (Plan 3a hotfix).
// Auth: next-auth session + isOperator flag.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { findFipTwin, type TournamentLike } from '@/lib/fip-twin-matcher'

interface Body {
  targetTournamentId?: unknown
  sourceTournamentId?: unknown
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const targetId = typeof body.targetTournamentId === 'string' ? body.targetTournamentId : null
  const sourceId = typeof body.sourceTournamentId === 'string' ? body.sourceTournamentId : null
  if (!targetId) {
    return Response.json({ error: 'targetTournamentId required' }, { status: 400 })
  }
  if (!sourceId) {
    return Response.json({ error: 'sourceTournamentId required' }, { status: 400 })
  }
  if (targetId === sourceId) {
    return Response.json({ error: 'target and source must differ' }, { status: 400 })
  }

  // Fetch both rows in parallel
  const [{ data: target, error: tErr }, { data: source, error: sErr }] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, name, slug, fip_id, padelapi_id, source, level, country, starts_at')
      .eq('id', targetId)
      .maybeSingle(),
    supabase
      .from('tournaments')
      .select('id, name, slug, fip_id, padelapi_id, source, level, country, starts_at')
      .eq('id', sourceId)
      .maybeSingle(),
  ])

  if (tErr) return Response.json({ error: `target read failed: ${tErr.message}` }, { status: 500 })
  if (sErr) return Response.json({ error: `source read failed: ${sErr.message}` }, { status: 500 })
  if (!target) return Response.json({ error: 'target tournament not found' }, { status: 404 })
  if (!source) return Response.json({ error: 'source tournament not found' }, { status: 404 })

  // Guardrails
  if (target.fip_id) {
    return Response.json(
      {
        error: `target already has fip_id='${target.fip_id}' — refusing to overwrite`,
      },
      { status: 409 },
    )
  }
  if (!source.fip_id) {
    return Response.json({ error: 'source has no fip_id to copy' }, { status: 400 })
  }
  if (source.source !== 'fip') {
    return Response.json(
      { error: `source.source='${source.source}' — only fip-discovered rows can be linked` },
      { status: 400 },
    )
  }

  // Re-validate the match is sane (same rule as the suggester — prevents
  // an operator from pasting arbitrary IDs by accident).
  const match = findFipTwin(target as TournamentLike, [source as TournamentLike])
  if (!match) {
    return Response.json(
      { error: 'match validation failed — source does not look like a twin of target' },
      { status: 400 },
    )
  }

  // ── Two-step update to work around unique constraints ──
  //
  // `tournaments.fip_id` has a UNIQUE constraint (tournaments_fip_id_key).
  // `tournaments.slug` is also effectively unique.
  //
  // The orphan row currently holds the fip_id (and usually the slug) we
  // want to copy onto the target. A naive UPDATE on target fails with:
  //   "duplicate key value violates unique constraint tournaments_fip_id_key"
  //
  // Solution: null out the orphan's fip_id + slug FIRST, then update the
  // target.
  const sourceFipId = source.fip_id
  const sourceSlug = source.slug
  const nowIso = new Date().toISOString()

  // Step 1 — clear orphan's identity fields to release the unique constraints.
  const { error: clearErr } = await supabase
    .from('tournaments')
    .update({
      fip_id: null,
      slug: null,
      last_updated_by: 'ops_manual_link_orphan_cleared',
      updated_at: nowIso,
    })
    .eq('id', source.id)

  if (clearErr) {
    return Response.json(
      { error: `orphan clear failed (unique constraint still held): ${clearErr.message}` },
      { status: 500 },
    )
  }

  // Step 2 — copy fip_id + slug onto the target.
  const { error: upErr } = await supabase
    .from('tournaments')
    .update({
      fip_id: sourceFipId,
      slug: sourceSlug ?? sourceFipId,
      last_updated_by: 'ops_manual_link',
      updated_at: nowIso,
    })
    .eq('id', targetId)

  if (upErr) {
    // Best-effort rollback: restore orphan's fip_id + slug.
    await supabase
      .from('tournaments')
      .update({ fip_id: sourceFipId, slug: sourceSlug })
      .eq('id', source.id)
    return Response.json(
      { error: `target update failed (orphan cleanup rolled back): ${upErr.message}` },
      { status: 500 },
    )
  }

  return Response.json({
    ok: true,
    target: { id: target.id, name: target.name },
    linked: {
      fip_id: sourceFipId,
      slug: sourceSlug ?? sourceFipId,
    },
    matchConfidence: match.confidence,
    matchedTokens: match.matchedTokens,
    orphanTwinId: source.id,
  })
}
