// src/app/api/notifications/unread-count/route.ts
// GET raw unread count for the current user. UI clamps to "99+".
// Uses the partial index on (user_id) WHERE read_at IS NULL for cheap counts.

import { getUserOrFail } from '../../user/_auth'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { count, error: dbErr } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  return Response.json({ count: count ?? 0 })
}
