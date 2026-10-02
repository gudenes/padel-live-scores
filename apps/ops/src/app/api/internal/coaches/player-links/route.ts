// apps/ops/src/app/api/internal/coaches/player-links/route.ts
// POST { coachId, playerId, decision: 'link' | 'reject' }
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { isUuid } from '@/lib/coaches'
import { linkCoachToPlayer, rejectCoachPlayerLink } from '@/lib/coach-player-link'

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
  const { coachId, playerId, decision } = body
  if (decision !== 'link' && decision !== 'reject') {
    return NextResponse.json({ error: 'need decision=link|reject' }, { status: 400 })
  }
  if (!isUuid(coachId) || !isUuid(playerId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const supabase = serviceClient()
  const result =
    decision === 'link'
      ? await linkCoachToPlayer(supabase, coachId, playerId)
      : await rejectCoachPlayerLink(supabase, coachId, playerId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
