// src/app/api/predictions/[matchId]/route.ts
//
// DELETE: remove the user's prediction for this match (only pre-lock-in)

import { getUserOrFail } from '../../user/_auth'
import { isPickWindowOpen } from '@/lib/predictions/server'
import type { Match } from '@/types/match'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data: match } = await supabase
    .from('matches')
    .select('id, status, scheduled_at')
    .eq('id', matchId)
    .maybeSingle()

  if (!match) return Response.json({ error: 'match_not_found' }, { status: 404 })
  if (!isPickWindowOpen(match as unknown as Match, new Date())) {
    return Response.json({ error: 'pick_window_closed' }, { status: 409 })
  }

  const { error: delErr } = await supabase
    .from('predictions')
    .delete()
    .eq('user_id', user.id)
    .eq('match_id', matchId)

  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
