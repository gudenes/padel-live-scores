// src/app/api/user/notification-prefs/route.ts
// GET    → { prefs: Record<category, { push, inApp }> }  (resolved with defaults)
// PATCH  body: { category, push?, inApp? }
//        → { ok: true, prefs: <resolved> }

import { getUserOrFail } from '../_auth'
import {
  isKnownCategory,
  resolveAllPrefs,
  type ChannelPrefs,
  type NotificationCategory,
} from '@/lib/notification-categories'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data, error: dbErr } = await supabase
    .from('profiles')
    .select('notification_prefs')
    .eq('id', user.id)
    .maybeSingle()

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  const stored = (data?.notification_prefs ?? null) as
    | Record<string, Partial<ChannelPrefs>>
    | null
  return Response.json({ prefs: resolveAllPrefs(stored) })
}

export async function PATCH(request: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await request.json().catch(() => null) as
    | { category?: unknown; push?: unknown; inApp?: unknown }
    | null
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  if (!isKnownCategory(body.category)) {
    return Response.json({ error: 'Unknown category' }, { status: 400 })
  }
  const category = body.category as NotificationCategory

  const hasPush = typeof body.push === 'boolean'
  const hasInApp = typeof body.inApp === 'boolean'
  if (!hasPush && !hasInApp) {
    return Response.json({ error: 'Expected push and/or inApp boolean' }, { status: 400 })
  }

  // Read-modify-write the JSONB. Concurrent writes for the same user are
  // extremely unlikely; last-write-wins is acceptable.
  const { data: row, error: readErr } = await supabase
    .from('profiles')
    .select('notification_prefs')
    .eq('id', user.id)
    .maybeSingle()
  if (readErr) return Response.json({ error: readErr.message }, { status: 500 })

  const current = (row?.notification_prefs ?? {}) as
    Record<string, Partial<ChannelPrefs>>
  const nextCategory = { ...(current[category] ?? {}) }
  if (hasPush) nextCategory.push = body.push as boolean
  if (hasInApp) nextCategory.inApp = body.inApp as boolean
  const next = { ...current, [category]: nextCategory }

  const { error: writeErr } = await supabase
    .from('profiles')
    .update({ notification_prefs: next })
    .eq('id', user.id)
  if (writeErr) return Response.json({ error: writeErr.message }, { status: 500 })

  return Response.json({ ok: true, prefs: resolveAllPrefs(next) })
}
