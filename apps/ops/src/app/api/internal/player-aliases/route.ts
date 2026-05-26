// apps/ops/src/app/api/internal/player-aliases/route.ts
//
// POST to upsert a player alias (entity_external_ids row with source='alias').
// Used by the ops "Unresolved Partner" modal when an operator links a parsed
// PDF name to an existing player. Future entry-list snapshots will resolve
// the same parsed string instantly via the alias index (powered by padelgod's
// db-resolver — see PR #435).
//
// Auth: Auth.js session with isOperator check.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { normalize } from '@/lib/player-resolver'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { playerId?: string; alias?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // Alias originates from a browser input field — trim before validation and
  // storage so whitespace-padded values can't pollute the alias index.
  const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : null
  const alias = typeof body.alias === 'string' ? body.alias.trim() : null
  if (!playerId || !alias) {
    return NextResponse.json({ error: 'missing required fields: playerId, alias' }, { status: 400 })
  }
  const norm = normalize(alias)
  if (!norm) return NextResponse.json({ error: 'alias normalizes to empty' }, { status: 400 })

  const supabase = serviceClient()
  const { error } = await supabase.from('entity_external_ids').upsert(
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
