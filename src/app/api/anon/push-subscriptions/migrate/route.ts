// POST /api/anon/push-subscriptions/migrate
//
// Move all anon_push_subscriptions for a given device_id into the
// authenticated push_subscriptions table under the current user, then
// delete the anon rows. The cascade trigger drops anon_bookmarks for
// the device automatically.
//
// Called by the client immediately after a successful sign-in (in the
// existing useFollowing migration block).
//
// Auth: requires a signed-in session; we read user.id from getUserOrFail
// rather than trusting the client.

import { getUserOrFail } from '../../../_auth'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(req: Request) {
  const { user, error: authErr } = await getUserOrFail()
  if (authErr) return authErr

  let body: { device_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isUuid(body.device_id)) {
    return Response.json({ error: 'Invalid or missing device_id' }, { status: 400 })
  }
  const deviceId = body.device_id

  // Fetch all anon subscriptions for this device.
  const { data: anonSubs, error: fetchErr } = await adminSupabase
    .from('anon_push_subscriptions')
    .select('endpoint, p256dh_key, auth_key')
    .eq('device_id', deviceId)

  if (fetchErr) {
    console.error('[anon-push] migrate fetch failed', fetchErr)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  const subs = anonSubs ?? []
  if (subs.length === 0) {
    return Response.json({ ok: true, migrated: 0 })
  }

  // Insert into the authenticated table. push_subscriptions.keys is
  // stored as a JSON object — match the shape used by the existing
  // /api/user/push-subscriptions POST.
  const userRows = subs.map(s => ({
    user_id: user.id,
    endpoint: s.endpoint,
    keys: { p256dh: s.p256dh_key, auth: s.auth_key },
  }))

  const { error: insertErr } = await adminSupabase
    .from('push_subscriptions')
    .upsert(userRows, { onConflict: 'user_id,endpoint' })

  if (insertErr) {
    console.error('[anon-push] migrate insert failed', insertErr)
    // Don't delete the anon rows — keeping them means the next sign-in
    // attempt can retry. Same retry pattern useFollowing migration uses.
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  // Delete anon subscriptions for this device. Trigger cascades the
  // anon_bookmarks rows.
  const { error: deleteErr } = await adminSupabase
    .from('anon_push_subscriptions')
    .delete()
    .eq('device_id', deviceId)

  if (deleteErr) {
    console.error('[anon-push] migrate delete failed', deleteErr)
    // Insert succeeded but delete didn't — the user will get duplicate
    // notifications until cleanup catches up. Log and continue.
    return Response.json({ ok: true, migrated: subs.length, delete_failed: true })
  }

  return Response.json({ ok: true, migrated: subs.length })
}
