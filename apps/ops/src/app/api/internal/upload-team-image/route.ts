// apps/ops/src/app/api/internal/upload-team-image/route.ts
// Multipart upload of a team's cover or crest. Stores it in the `teams` bucket
// as {kind}-{teamId}.{ext} and returns the public URL. Does NOT write the DB
// row — the caller persists it with PATCH /api/internal/team/[id], the same
// split upload-equipment-image uses.

import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { ensureTeamBucket, isTeamImageKind, pickExtension, TEAM_BUCKET } from '@/lib/team-image'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 2 * 1024 * 1024

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
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

  const kind = String(form.get('kind') ?? '')
  const teamId = String(form.get('teamId') ?? '')
  const file = form.get('file')

  if (!isTeamImageKind(kind)) {
    return Response.json({ error: 'kind must be "cover" or "crest"' }, { status: 400 })
  }
  if (!isUuid(teamId)) {
    return Response.json({ error: 'teamId must be a uuid' }, { status: 400 })
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

  const bucket = await ensureTeamBucket(supabase)
  if (!bucket.ok) {
    return Response.json({ error: 'Failed to create bucket', detail: bucket.error }, { status: 500 })
  }

  const ext = pickExtension(file.type)
  const filePath = `${kind}-${teamId}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from(TEAM_BUCKET)
    .upload(filePath, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return Response.json({ error: 'upload failed', detail: uploadError.message }, { status: 500 })
  }

  // ?v= is load-bearing: the key is stable per team and kind, so a replacement
  // image would otherwise be masked by the CDN and by next/image's cache.
  const url =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${TEAM_BUCKET}/${filePath}` +
    `?v=${Date.now()}`

  return Response.json({ url })
}
