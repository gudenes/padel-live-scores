// src/app/api/admin/test-push/route.ts
// Send a one-off test push notification to a specific user by email.
// Useful for verifying end-to-end delivery (VAPID → browser push service →
// service worker → OS notification, OR FCM → Android Play Store app)
// without having to wait for a real match-live transition.
//
// Fans out to BOTH transports the user might have registered:
//   - push_subscriptions  (Web Push, via VAPID)
//   - native_push_subscriptions  (FCM tokens from the Capacitor app)
//
// Stale endpoints/tokens get cleaned automatically (mirrors the cleanup
// behavior in /api/push/notify).
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
//   {
//     ok,
//     user_id,
//     subscriptions_found,        // Web Push rows
//     sent,                       // Web Push successes
//     stale_cleaned,              // Web Push rows deleted
//     fcm_subscriptions_found,    // FCM rows
//     fcm_sent,                   // FCM successes
//     fcm_failed,                 // FCM failures (transient)
//     fcm_stale_cleaned,          // FCM rows deleted (invalid tokens)
//   }

import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'
import { sendPushToFcmTokens } from '@/lib/push-fcm'

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

  // Fetch BOTH transports in parallel — Web Push + FCM. Either may be
  // empty for a given user (e.g. Play Store-only install has FCM but no
  // Web Push; PWA-only install has Web Push but no FCM).
  const [webRes, fcmRes] = await Promise.all([
    supabase
      .from('push_subscriptions')
      .select('id, endpoint, keys')
      .eq('user_id', resolvedUserId!),
    supabase
      .from('native_push_subscriptions')
      .select('id, device_token')
      .eq('user_id', resolvedUserId!),
  ])

  if (webRes.error) {
    return Response.json({ error: `Web subscription lookup failed: ${webRes.error.message}` }, { status: 500 })
  }
  if (fcmRes.error) {
    return Response.json({ error: `FCM subscription lookup failed: ${fcmRes.error.message}` }, { status: 500 })
  }

  const subscriptions = webRes.data ?? []
  const fcmSubscriptions = fcmRes.data ?? []

  if (subscriptions.length === 0 && fcmSubscriptions.length === 0) {
    return Response.json({
      ok: true,
      user_id: resolvedUserId,
      subscriptions_found: 0,
      sent: 0,
      fcm_subscriptions_found: 0,
      fcm_sent: 0,
      note: 'User has no push subscriptions on either transport — ensure they enabled notifications on a device (PWA or native app)',
    })
  }

  const payload = {
    title: title || 'Test notification',
    body: msgBody || 'If you see this, push works!',
    url: url || '/',
    tag: `test-${Date.now()}`,
  }

  // ── Web Push fan-out ──────────────────────────────────────────────
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

  // ── FCM fan-out (Capacitor native devices) ────────────────────────
  // Mirrors the FCM block in /api/push/notify so the test surface
  // matches the production fan-out behavior. Invalid tokens get
  // cleaned from native_push_subscriptions.
  let fcmSent = 0
  let fcmFailed = 0
  let fcmStaleCleaned = 0

  if (fcmSubscriptions.length > 0) {
    const tokens = fcmSubscriptions
      .map(s => s.device_token as string)
      .filter((t): t is string => !!t)
    try {
      const result = await sendPushToFcmTokens(tokens, payload)
      fcmSent = result.success
      fcmFailed = result.failed
      if (result.invalidTokens.length > 0) {
        const { error: delErr } = await supabase
          .from('native_push_subscriptions')
          .delete()
          .in('device_token', result.invalidTokens)
        if (!delErr) fcmStaleCleaned = result.invalidTokens.length
      }
    } catch (err) {
      console.error('[test-push] FCM send failed:', (err as Error).message)
      fcmFailed = tokens.length
    }
  }

  return Response.json({
    ok: true,
    user_id: resolvedUserId,
    subscriptions_found: subscriptions.length,
    sent,
    stale_cleaned: staleIds.length,
    fcm_subscriptions_found: fcmSubscriptions.length,
    fcm_sent: fcmSent,
    fcm_failed: fcmFailed,
    fcm_stale_cleaned: fcmStaleCleaned,
  })
}
