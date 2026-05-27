// src/app/api/notifications/route.ts
// GET current user's notifications, newest first. Supports:
//   - ?limit=30      (clamped server-side to 1..100)
//   - ?before=ISO    (cursor — returns created_at < before)
//   - ?filter=all|matches|updates
//
// Returns: { items: NotificationRow[], nextCursor: string | null }
//   nextCursor is the created_at of the last row, null when fewer than
//   `limit` rows returned (i.e. no more pages).

import { getUserOrFail } from '../user/_auth'
import { categoryFilter } from '@/lib/notification-categories'

export async function GET(request: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const url = new URL(request.url)
  const rawLimit = Number(url.searchParams.get('limit') ?? '30')
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 30, 1), 100)
  const before = url.searchParams.get('before')
  const filter = url.searchParams.get('filter') ?? 'all'

  let query = supabase
    .from('user_notifications')
    .select('id, category, title, body, url, metadata, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) query = query.lt('created_at', before)

  const cats = categoryFilter(filter)
  if (cats !== null) {
    if (cats.length === 0) {
      return Response.json({ items: [], nextCursor: null })
    }
    query = query.in('category', cats)
  }

  const { data, error: dbErr } = await query
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  const items = data ?? []
  const nextCursor = items.length === limit ? items[items.length - 1].created_at : null

  return Response.json({ items, nextCursor })
}
