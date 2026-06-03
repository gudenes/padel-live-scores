// apps/ops/src/app/api/internal/upload-ad-banner-image/route.ts
// Multipart upload of an ad banner creative to the `ad-banners` bucket as
// banner-{bannerId}.{ext}; returns the public URL. Auth: operator session.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const MAX_BYTES = 2 * 1024 * 1024
const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg',
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
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

  const bannerId = String(form.get('bannerId') ?? '')
  const file = form.get('file')

  if (!isUuid(bannerId)) return Response.json({ error: 'bannerId must be a uuid' }, { status: 400 })
  if (!(file instanceof File)) return Response.json({ error: 'file is required' }, { status: 400 })
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 400 })
  }

  const supabase = serviceClient()
  const filePath = `banner-${bannerId}.${EXT[file.type]}`
  const buffer = await file.arrayBuffer()
  const { error } = await supabase.storage
    .from('ad-banners')
    .upload(filePath, buffer, { contentType: file.type, upsert: true })
  if (error) return Response.json({ error: 'upload failed', detail: error.message }, { status: 500 })

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/ad-banners/${filePath}`
  return Response.json({ url })
}
