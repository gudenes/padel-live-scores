// apps/ops/src/app/api/internal/player-aliases/route.ts
//
// POST: store an alias for an existing player. Used by the Resolve Partner
// modal's Link tab. After the alias is written, future fetcher snapshots
// resolve the same parsed string instantly via padelgod's db-resolver.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'
import { normalizeName } from '@/lib/normalize-name'

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
  const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : null
  const alias = typeof body.alias === 'string' ? body.alias.trim() : null
  if (!playerId || !alias) {
    return NextResponse.json({ error: 'missing required fields: playerId, alias' }, { status: 400 })
  }
  const norm = normalizeName(alias)
  if (!norm) return NextResponse.json({ error: 'alias normalizes to empty' }, { status: 400 })

  await pgPool().query(
    `insert into public.entity_external_ids
       (entity_type, entity_id, source, external_id, metadata, last_seen_at)
     values ('player', $1, 'alias', $2, jsonb_build_object('normalized', $3::text), now())
     on conflict (source, entity_type, external_id) do update
       set entity_id = excluded.entity_id,
           metadata = excluded.metadata,
           last_seen_at = excluded.last_seen_at`,
    [playerId, alias, norm],
  )
  return NextResponse.json({ ok: true })
}
