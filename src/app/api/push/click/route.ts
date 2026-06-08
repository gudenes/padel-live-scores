// src/app/api/push/click/route.ts
// Beacon target for web push click-through. Unauthenticated (it's a
// navigator.sendBeacon / keepalive fetch from the service worker), but it
// only accepts a known send_id and stores no PII.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function POST(request: Request) {
  const { send_id, platform } = (await request.json().catch(() => ({}))) as {
    send_id?: string; platform?: string
  }
  if (!send_id) return Response.json({ ok: false }, { status: 400 })

  const { error } = await supabase
    .from('notification_clicks')
    .insert({ send_id, platform: platform ?? 'web' })
  if (error) {
    // Unknown send_id (FK violation) or transient — swallow, it's a beacon.
    return Response.json({ ok: false }, { status: 202 })
  }
  const { error: rpcErr } = await supabase.rpc('increment_notification_clicks', { p_send_id: send_id })
  if (rpcErr) {
    // The click row is recorded; only the denormalized counter missed. Log so
    // notification_clicks vs notification_sends.clicks drift is diagnosable.
    console.error('[Push] increment_notification_clicks failed:', rpcErr.message)
  }
  return Response.json({ ok: true })
}
