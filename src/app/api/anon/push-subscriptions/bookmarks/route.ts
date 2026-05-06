// /api/anon/push-subscriptions/bookmarks
//
// Add or remove a single anonymous bookmark for a registered device.
//
// POST: insert ON CONFLICT DO NOTHING.
// DELETE: remove the matching row.
//
// Both routes are idempotent. They do NOT verify that the device has a
// live subscription — bookmarks can exist without a subscription if the
// browser revoked permission. Push delivery naturally only reaches
// devices with both a row in anon_push_subscriptions AND a matching
// anon_bookmarks row, so this is safe.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface BookmarkBody {
  device_id: string
  type: 'player' | 'match'
  target_id: string
}

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function validateBody(raw: unknown): BookmarkBody | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (!isUuid(b.device_id)) return null
  if (b.type !== 'player' && b.type !== 'match') return null
  if (!isUuid(b.target_id)) return null
  return { device_id: b.device_id, type: b.type, target_id: b.target_id }
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const body = validateBody(raw)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const { error } = await supabase
    .from('anon_bookmarks')
    .upsert(
      {
        device_id: body.device_id,
        bookmark_type: body.type,
        target_id: body.target_id,
      },
      { onConflict: 'device_id,bookmark_type,target_id' },
    )

  if (error) {
    console.error('[anon-push] bookmark insert failed', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const body = validateBody(raw)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  await supabase
    .from('anon_bookmarks')
    .delete()
    .eq('device_id', body.device_id)
    .eq('bookmark_type', body.type)
    .eq('target_id', body.target_id)
  // Always return ok — deleting a non-existent row is a no-op.
  return Response.json({ ok: true })
}
