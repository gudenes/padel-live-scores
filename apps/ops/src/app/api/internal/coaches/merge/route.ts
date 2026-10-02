// apps/ops/src/app/api/internal/coaches/merge/route.ts
// POST { sourceId, targetId, keepSourceName? } → merge_coaches() (atomic, in Postgres).
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { isUuid } from '@/lib/coaches'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  if (!isUuid(body.sourceId) || !isUuid(body.targetId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  if (body.keepSourceName !== undefined && typeof body.keepSourceName !== 'boolean') {
    return NextResponse.json({ error: 'keepSourceName must be boolean' }, { status: 400 })
  }
  const { error } = await serviceClient().rpc('merge_coaches', {
    p_source: body.sourceId,
    p_target: body.targetId,
    p_keep_source_name: body.keepSourceName === true,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, targetId: body.targetId })
}
