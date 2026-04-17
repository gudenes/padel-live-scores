// src/app/api/admin/test-push/route.ts
// Send a one-off test push notification to a specific user by email.
// Useful for verifying end-to-end delivery (VAPID → browser push service →
// service worker → OS notification) without having to wait for a real
// match-live transition.
//
// Usage:
//   curl -X POST https://padelnachos.com/api/admin/test-push \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"email":"gudenes@gmail.com"}'
//
// Optional body fields:
//   title   — override notification title (default "Test notification")
//   body    — override notification body (default "If you see this, push works!")
//   url     — deep link path (default "/")
//
// Response shape:
//   { ok, user_id, subscriptions_found, sent, stale_cleaned }

import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { email, userId, title, body: msgBody, url } = body as {
    email?: string
    userId?: string
    title?: string
    body?: string
    url?: string
  }

  if (!email && !userId) {
    return Response.json({ error: 'Provide either email or userId' }, { status: 400 })
  }

  // Resolve user_id — Auth.js PostgresAdapter stores users in public.users
  let resolvedUserId = userId
  if (!resolvedUserId && email) {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (error) return Response.json({ error: `User lookup failed: ${error.message}` }, { status: 500 })
    if (!data) return Response.json({ error: `No user with email ${email}` }, { status: 404 })
    resolvedUserId = data.id as string
  }

  // Fetch all push subscriptions for this user
  const { data: subscriptions, error: subErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, keys')
    .eq('user_id', resolvedUserId!)

  if (subErr) return Response.json({ error: `Subscription lookup failed: ${subErr.message}` }, { status: 500 })
  if (!subscriptions?.length) {
    return Response.json({
      ok: true,
      user_id: resolvedUserId,
      subscriptions_found: 0,
      sent: 0,
      note: 'User has no push subscriptions — ensure they enabled notifications on a device',
    })
  }

  const payload = {
    title: title || 'Test notification',
    body: msgBody || 'If you see this, push works!',
    url: url || '/',
    tag: `test-${Date.now()}`,
  }

  const staleIds: string[] = []
  let sent = 0

  await Promise.allSettled(
    subscriptions.map(async sub => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ok = await sendPush({ endpoint: sub.endpoint as string, keys: sub.keys as any }, payload)
      if (ok) sent++
      else staleIds.push(sub.id as string)
    }),
  )

  if (staleIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', staleIds)
  }

  return Response.json({
    ok: true,
    user_id: resolvedUserId,
    subscriptions_found: subscriptions.length,
    sent,
    stale_cleaned: staleIds.length,
  })
}
