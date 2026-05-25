// apps/ops/src/app/api/internal/tournament-explorer/[id]/route.ts
//
// GET single-tournament view with entry list (ghost-synthesized).
// Auth: requires operator session.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getEntryListPayload } from '@/lib/entry-list-aggregator'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const payload = await getEntryListPayload(id)
  if (!payload) {
    return NextResponse.json({ error: 'tournament not found' }, { status: 404 })
  }
  return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } })
}
