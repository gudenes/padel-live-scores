// /api/anon/push-subscriptions
//
// Anonymous Web Push subscription registration + unsubscribe.
//
// POST: register the subscription and bulk-insert initial bookmarks.
//   Body: { device_id, endpoint, keys: {p256dh,auth}, user_agent, bookmarks: [{type,target_id}] }
//   Idempotent on `endpoint` — same device re-registering replaces the row.
//   Bookmarks insert with ON CONFLICT DO NOTHING so it's safe to call
//   with the user's full follow set even on re-register.
//
// DELETE: unsubscribe a single endpoint.
//   Body: { endpoint }
//   The cascade trigger handles anon_bookmarks cleanup.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface PostBody {
  device_id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
  user_agent?: string
  bookmarks?: Array<{ type: 'player' | 'match'; target_id: string }>
}

interface DeleteBody {
  endpoint: string
}

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(req: Request) {
  let body: Partial<PostBody>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isUuid(body.device_id)) {
    return Response.json({ error: 'Invalid or missing device_id' }, { status: 400 })
  }
  if (typeof body.endpoint !== 'string' || !body.endpoint.startsWith('http')) {
    return Response.json({ error: 'Invalid or missing endpoint' }, { status: 400 })
  }
  if (!body.keys || typeof body.keys.p256dh !== 'string' || typeof body.keys.auth !== 'string') {
    return Response.json({ error: 'Invalid or missing keys' }, { status: 400 })
  }

  const { error: subErr } = await supabase
    .from('anon_push_subscriptions')
    .upsert(
      {
        device_id: body.device_id,
        endpoint: body.endpoint,
        p256dh_key: body.keys.p256dh,
        auth_key: body.keys.auth,
        user_agent: body.user_agent ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )

  if (subErr) {
    console.error('[anon-push] upsert subscription failed', subErr)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  // Bulk-insert bookmarks. Filter to types we accept; the DB CHECK
  // constraint also enforces this server-side.
  if (Array.isArray(body.bookmarks) && body.bookmarks.length > 0) {
    const rows = body.bookmarks
      .filter(b =>
        (b.type === 'player' || b.type === 'match') &&
        isUuid(b.target_id),
      )
      .map(b => ({
        device_id: body.device_id,
        bookmark_type: b.type,
        target_id: b.target_id,
      }))

    if (rows.length > 0) {
      const { error: bmErr } = await supabase
        .from('anon_bookmarks')
        .upsert(rows, { onConflict: 'device_id,bookmark_type,target_id' })
      if (bmErr) {
        console.error('[anon-push] upsert bookmarks failed', bmErr)
        // Subscription succeeded; bookmarks failed — return a partial-success
        // signal so the client can retry the bookmarks step on next toggle.
        return Response.json({ ok: true, bookmarks_failed: true })
      }
    }
  }

  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  let body: Partial<DeleteBody>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.endpoint !== 'string' || !body.endpoint.startsWith('http')) {
    return Response.json({ error: 'Invalid or missing endpoint' }, { status: 400 })
  }

  await supabase
    .from('anon_push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint)
  // Trigger handles anon_bookmarks cleanup. We always return ok — DELETE
  // for an endpoint that doesn't exist is a no-op, not an error.
  return Response.json({ ok: true })
}
