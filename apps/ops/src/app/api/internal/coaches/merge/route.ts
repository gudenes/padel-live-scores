// apps/ops/src/app/api/internal/coaches/merge/route.ts
// POST { sourceId, targetId, keepSourceName? } → merge_coaches() (atomic, in Postgres).
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: { sourceId?: string; targetId?: string; keepSourceName?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.sourceId || !body.targetId) {
    return NextResponse.json({ error: 'missing required fields: sourceId, targetId' }, { status: 400 })
  }
  const { error } = await serviceClient().rpc('merge_coaches', {
    p_source: body.sourceId,
    p_target: body.targetId,
    p_keep_source_name: body.keepSourceName === true,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, targetId: body.targetId })
}
