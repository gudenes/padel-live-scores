// apps/ops/src/app/api/internal/upload-player-avatar/route.ts
// Multipart upload of an amateur player's photo.
// Stores it in the `avatars` Supabase Storage bucket as {playerId}.{ext} and
// returns the public URL. Does NOT write the DB row — the caller persists it
// with the existing PATCH /api/internal/player/[id], which already allow-lists
// avatar_url. Same split as upload-equipment-image.
//
// Amateurs only: source-priority gives players.avatar_url to padelapi, so a
// manual photo on a professional would be overwritten the next time the sync
// runs (currently paused behind PADELAPI_PAUSED). A photo that silently
// disappears is worse than a button that isn't there.

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 2 * 1024 * 1024
const BUCKET = 'avatars'

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function pickExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  return 'jpg'
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const playerId = String(form.get('playerId') ?? '')
  const file = form.get('file')

  if (!isUuid(playerId)) {
    return Response.json({ error: 'playerId must be a uuid' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return Response.json({ error: 'file is required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json(
      { error: `Unsupported file type: ${file.type}`, allowed: Array.from(ALLOWED_MIME) },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 400 })
  }

  const supabase = serviceClient()

  const { data: player } = await supabase
    .from('players')
    .select('tier')
    .eq('id', playerId)
    .single()

  if (!player) {
    return Response.json({ error: 'player not found' }, { status: 404 })
  }
  if (player.tier !== 'amateur') {
    return Response.json(
      { error: 'Photo upload is available for amateur players only' },
      { status: 400 },
    )
  }

  const ext = pickExtension(file.type)
  const filePath = `${playerId}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return Response.json({ error: 'upload failed', detail: uploadError.message }, { status: 500 })
  }

  // ?v= is load-bearing: the key is stable per player, so a replacement photo
  // would otherwise be masked by the CDN and by next/image's cache.
  const url =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}` +
    `?v=${Date.now()}`

  return Response.json({ url })
}
