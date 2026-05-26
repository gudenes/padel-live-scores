// apps/ops/src/app/api/internal/upload-equipment-image/route.ts
// Multipart upload of an equipment image (brand logo or racket image).
// Stores in the `equipment` Supabase Storage bucket as
//   {kind}-{entityId}.{ext}
// and returns the public URL. Does NOT update the DB row — that happens
// via the existing PATCH from BrandsTab.
//
// Auth: Auth.js session with isOperator flag.
// Ported from src/app/api/ops/upload-equipment-image/route.ts (Plan 3a hotfix).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import {
  ensureEquipmentBucket,
  pickExtension,
  type EquipmentKind,
} from '@/lib/equipment-image-rehost'

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])
const MAX_BYTES = 2 * 1024 * 1024

function isEquipmentKind(value: string): value is EquipmentKind {
  return value === 'brand' || value === 'racket'
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const kind = String(form.get('kind') ?? '')
  const entityId = String(form.get('entityId') ?? '')
  const file = form.get('file')

  if (!isEquipmentKind(kind)) {
    return Response.json({ error: 'kind must be "brand" or "racket"' }, { status: 400 })
  }
  if (!isUuid(entityId)) {
    return Response.json({ error: 'entityId must be a uuid' }, { status: 400 })
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

  const bucket = await ensureEquipmentBucket(supabase)
  if (!bucket.ok) {
    return Response.json({ error: 'Failed to create bucket', detail: bucket.error }, { status: 500 })
  }

  const ext = pickExtension(file.type)
  const filePath = `${kind}-${entityId}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from('equipment')
    .upload(filePath, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return Response.json({ error: 'upload failed', detail: uploadError.message }, { status: 500 })
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/equipment/${filePath}`
  return Response.json({ url })
}
