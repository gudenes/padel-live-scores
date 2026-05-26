// apps/ops/src/app/api/internal/news/upload/route.ts
// Upload a cover image to the `news-covers` Supabase Storage bucket.
// Returns the public URL.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024  // 5 MB

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const formData = await req.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return Response.json({ error: 'file field is required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return Response.json({ error: `mime type ${file.type} not allowed` }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'file exceeds 5 MB' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
  const objectKey = `${crypto.randomUUID()}.${safeExt}`

  const arrayBuffer = await file.arrayBuffer()
  const { error } = await supabase.storage
    .from('news-covers')
    .upload(objectKey, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const { data } = supabase.storage.from('news-covers').getPublicUrl(objectKey)
  return Response.json({ url: data.publicUrl, key: objectKey })
}
