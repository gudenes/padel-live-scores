// apps/ops/src/app/api/internal/coaches/player-links/route.ts
// POST { coachId, playerId, decision: 'link' | 'reject' }
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: { coachId?: string; playerId?: string; decision?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const { coachId, playerId, decision } = body
  if (!coachId || !playerId || (decision !== 'link' && decision !== 'reject')) {
    return NextResponse.json({ error: 'need coachId, playerId, decision=link|reject' }, { status: 400 })
  }
  const supabase = serviceClient()
  const now = new Date().toISOString()

  if (decision === 'link') {
    const { error } = await supabase.from('coaches').update({ player_id: playerId, updated_at: now }).eq('id', coachId)
    if (error) {
      const status = error.code === '23505' ? 409 : 500
      return NextResponse.json({ error: error.code === '23505' ? 'that player is already linked to another coach' : error.message }, { status })
    }
    await supabase.from('coach_player_link_suggestions').update({ status: 'rejected', decided_at: now })
      .eq('coach_id', coachId).eq('status', 'pending').neq('player_id', playerId)
  }
  const { error } = await supabase
    .from('coach_player_link_suggestions')
    .update({ status: decision === 'link' ? 'linked' : 'rejected', decided_at: now })
    .eq('coach_id', coachId)
    .eq('player_id', playerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
