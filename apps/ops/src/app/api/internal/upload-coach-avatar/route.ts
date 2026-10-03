import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { isUuid } from '@/lib/coaches'

const BUCKET = 'coach-avatars'
const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

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
  const coachId = form.get('coachId')
  if (!isUuid(coachId)) return Response.json({ error: 'A valid coach ID is required' }, { status: 400 })
  const file = form.get('file')
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: 'Choose a JPG, PNG or WebP photo' }, { status: 400 })
  }
  if (!file.size || file.size > MAX_BYTES) {
    return Response.json({ error: 'Choose a non-empty photo up to 2 MB' }, { status: 400 })
  }
  const supabase = serviceClient()
  const { data: coach, error: lookupError } = await supabase.from('coaches')
    .select('id, status').eq('id', coachId).maybeSingle()
  if (lookupError) return Response.json({ error: 'Could not load coach' }, { status: 500 })
  if (!coach) return Response.json({ error: 'Coach not found' }, { status: 404 })
  if (coach.status === 'merged') return Response.json({ error: 'This coach was merged. Open the surviving coach to upload a photo.' }, { status: 409 })

  // Decode the actual image, apply camera orientation and strip metadata.
  let image: Buffer
  try {
    image = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer()
  } catch {
    return Response.json({ error: 'This photo could not be read. Choose a valid JPG, PNG or WebP image.' }, { status: 400 })
  }
  const storage = supabase.storage.from(BUCKET)
  // Unique keys prevent stale caches and preserve the old photo on save failure.
  const path = `${coachId}/${randomUUID()}.webp`
  const { error: uploadError } = await storage.upload(path, image, { contentType: 'image/webp' })
  if (uploadError) return Response.json({ error: 'Could not upload coach photo' }, { status: 500 })
  const { data: { publicUrl } } = storage.getPublicUrl(path)
  const { data: saved, error: saveError } = await supabase.from('coaches').update({
    avatar_url: publicUrl,
    updated_at: new Date().toISOString(),
  }).eq('id', coachId).neq('status', 'merged').select('id').maybeSingle()
  if (saveError || !saved) {
    await storage.remove([path])
    return Response.json({ error: 'Could not save coach photo. Please try again.' }, { status: 500 })
  }
  return Response.json({ url: publicUrl })
}
