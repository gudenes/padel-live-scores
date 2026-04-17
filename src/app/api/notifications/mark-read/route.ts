// src/app/api/notifications/mark-read/route.ts
// Body: { ids: string[] } | { all: true }
// Only updates rows belonging to the current user that are still unread,
// so it's safe to retry.
// Response: { updated: number }

import { getUserOrFail } from '../../user/_auth'

export async function POST(request: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await request.json().catch(() => null) as
    | { ids?: unknown; all?: unknown }
    | null
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  const now = new Date().toISOString()

  let query = supabase
    .from('user_notifications')
    .update({ read_at: now }, { count: 'exact' })
    .eq('user_id', user.id)
    .is('read_at', null)

  if (body.all === true) {
    // no extra filter — mark every unread row
  } else if (Array.isArray(body.ids) && body.ids.every((x): x is string => typeof x === 'string')) {
    if (body.ids.length === 0) return Response.json({ updated: 0 })
    query = query.in('id', body.ids)
  } else {
    return Response.json({ error: 'Expected { ids: string[] } or { all: true }' }, { status: 400 })
  }

  const { count, error: dbErr } = await query
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  return Response.json({ updated: count ?? 0 })
}
