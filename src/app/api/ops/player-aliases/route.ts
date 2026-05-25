// src/app/api/ops/player-aliases/route.ts
//
// POST to upsert a player alias (entity_external_ids row with source='alias').
// Used by the ops "Unresolved Partner" modal when an operator links a parsed
// PDF name to an existing player. Future entry-list snapshots will resolve
// the same parsed string instantly via the alias index.
//
// Auth: reads ops_token cookie via checkOpsAuth.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { normalize as normalizeName } from '@/lib/player-resolver'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let body: { playerId?: string; alias?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : null
  // Alias originates from a browser input field — trim before validation and
  // storage so whitespace-padded values can't pollute the alias index.
  const alias = typeof body.alias === 'string' ? body.alias.trim() : null
  if (!playerId || !alias) {
    return Response.json({ error: 'missing required fields: playerId, alias' }, { status: 400 })
  }
  const norm = normalizeName(alias)
  if (!norm) return Response.json({ error: 'alias normalizes to empty' }, { status: 400 })

  // No .select().single() suffix — we only need success/failure. The suffix
  // can produce spurious PGRST116 errors on certain conflict paths and adds
  // no value when the row contents are already known to the caller.
  const { error } = await supabase
    .from('entity_external_ids')
    .upsert(
      {
        entity_type: 'player',
        entity_id: playerId,
        source: 'alias',
        external_id: alias,
        metadata: { normalized: norm },
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'source,entity_type,external_id' },
    )

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ ok: true })
}
