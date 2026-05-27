// src/app/api/user/notification-prefs/route.ts
// GET    → { prefs: Record<category, { push }>, mute_until: string | null }
// PATCH  body: { category, push }          → { ok: true, prefs: <resolved> }
//        body: { mute_until }              → { ok: true }  (mute-only patch)
// Stale clients sending { category, push, inApp } are tolerated — inApp is silently ignored.

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
    .select('notification_prefs, notification_mute_until')
    .eq('id', user.id)
    .maybeSingle()

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  const stored = (data?.notification_prefs ?? null) as
    | Record<string, Partial<ChannelPrefs>>
    | null
  return Response.json({
    prefs: resolveAllPrefs(stored),
    mute_until: (data as { notification_mute_until?: string | null } | null)?.notification_mute_until ?? null,
  })
}

export async function PATCH(request: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  // Accept { category, push } from the new Settings page.
  // Stale clients may still send inApp — accepted and silently ignored.
  const body = await request.json().catch(() => null) as
    | { category?: unknown; push?: unknown; [key: string]: unknown }
    | null
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  // Mute-only patch — no `category` key, just `mute_until`
  if ('mute_until' in body && !('category' in body)) {
    const value = body.mute_until === null ? null : String(body.mute_until)
    // Validate: must be null, 'forever', or parseable ISO date
    if (value !== null && value !== 'forever') {
      const parsed = Date.parse(value)
      if (Number.isNaN(parsed)) {
        return Response.json({ error: 'invalid mute_until' }, { status: 400 })
      }
    }
    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ notification_mute_until: value })
      .eq('id', user.id)
    if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (!isKnownCategory(body.category)) {
    return Response.json({ error: 'Unknown category' }, { status: 400 })
  }
  const category = body.category as NotificationCategory

  const hasPush = typeof body.push === 'boolean'
  if (!hasPush) {
    return Response.json({ error: 'Expected push boolean' }, { status: 400 })
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
  nextCategory.push = body.push as boolean
  const next = { ...current, [category]: nextCategory }

  const { error: writeErr } = await supabase
    .from('profiles')
    .update({ notification_prefs: next })
    .eq('id', user.id)
  if (writeErr) return Response.json({ error: writeErr.message }, { status: 500 })

  return Response.json({ ok: true, prefs: resolveAllPrefs(next) })
}
