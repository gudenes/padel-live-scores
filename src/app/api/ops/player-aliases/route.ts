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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let body: { playerId?: string; alias?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const { playerId, alias } = body
  if (!playerId || !alias || typeof playerId !== 'string' || typeof alias !== 'string') {
    return Response.json({ error: 'missing required fields: playerId, alias' }, { status: 400 })
  }
  const norm = normalizeName(alias)
  if (!norm) return Response.json({ error: 'alias normalizes to empty' }, { status: 400 })

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
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ ok: true })
}
