// src/app/api/user/native-push-subscriptions/route.ts
// Sibling to /api/user/push-subscriptions — stores FCM/APNs device
// tokens for native (Capacitor) clients. Same auth pattern as the
// Web Push route; schema lives in native_push_subscriptions.

import { getUserOrFail } from '../_auth'

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await req.json().catch(() => null)
  if (!body || !body.platform || !body.deviceToken) {
    return Response.json({ error: 'Missing platform or deviceToken' }, { status: 400 })
  }
  if (body.platform !== 'android' && body.platform !== 'ios') {
    return Response.json({ error: 'Invalid platform' }, { status: 400 })
  }

  const { error: dbErr } = await supabase
    .from('native_push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        platform: body.platform,
        device_token: body.deviceToken,
        locale: body.locale || 'en',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_token' },
    )

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { deviceToken } = await req.json().catch(() => ({}))
  if (!deviceToken) return Response.json({ error: 'Missing deviceToken' }, { status: 400 })

  await supabase
    .from('native_push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('device_token', deviceToken)

  return Response.json({ ok: true })
}
