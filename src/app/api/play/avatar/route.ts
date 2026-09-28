import { readProductionAvatarSettings } from '@/lib/production-avatar-settings'
import { reserveProductionAvatar, saveProductionAvatar } from '@/lib/production-avatar-store'
import { hasSameLocalOrigin } from '@/lib/local-request-origin'
import { readAvatarSettings } from '@/lib/local-avatar-settings'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { requirePlayAccess } from '@/lib/play-access'
import { AvatarGenerationError, generateAvatar, isLocalAvatarRequest } from '@/lib/avatar-generation'
import { reserveAvatarGeneration, saveLocalAvatar } from '@/lib/avatar-local-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180
const MAX_UPLOAD = 6 * 1024 * 1024
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } }) }

export async function GET(req: Request) {
  const access = await requirePlayAccess()
  if ((!isLocalAvatarRequest(req) && process.env.NODE_ENV !== 'production') || !access) return json({ error: 'not_found' }, 404)
  try { const settings = process.env.NODE_ENV === 'production' ? await readProductionAvatarSettings(access.supabase) : await readAvatarSettings(); return json({ enabled: settings.enabled && !!settings.apiKey, dailyLimit: 5 }) }
  catch { return json({ error: 'not_configured' }, 503) }
}

export async function POST(req: Request) {
  if (!isLocalAvatarRequest(req) && process.env.NODE_ENV !== 'production') return json({ error: 'not_found' }, 404)
  if (!(process.env.NODE_ENV === 'production' ? ['https://padelnachos.com','https://www.padelnachos.com'].includes(req.headers.get('origin') ?? '') : hasSameLocalOrigin(req))) return json({ error: 'invalid_origin' }, 403)
  const access = await requirePlayAccess()
  if (!access) return json({ error: 'not_found' }, 404)
  const settings = await (process.env.NODE_ENV === 'production' ? readProductionAvatarSettings(access.supabase) : readAvatarSettings()).catch(() => null)
  const key = settings?.enabled ? settings.apiKey : null
  if (!key) return json({ error: 'not_configured' }, 503)
  if (!req.headers.get('content-type')?.startsWith('multipart/form-data')) return json({ error: 'invalid_photo' }, 400)
  let release: (() => Promise<void>) | undefined
  try {
    // Enforce the bound while reading, including requests without Content-Length.
    const reader = req.body?.getReader()
    if (!reader) return json({ error: 'invalid_photo' }, 400)
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > MAX_UPLOAD + 64 * 1024) { await reader.cancel(); return json({ error: 'photo_too_large' }, 413) }
      chunks.push(part.value)
    }
    const parsed = new Request(req.url, { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) })
    const form = await parsed.formData()
    if (form.get('consent') !== 'true') return json({ error: 'consent_required' }, 400)
    const photo = form.get('photo')
    if (!(photo instanceof File) || !photo.size || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) return json({ error: 'invalid_photo' }, 400)
    if (photo.size > MAX_UPLOAD) return json({ error: 'photo_too_large' }, 413)
    let clean: Buffer
    try {
      clean = await sharp(Buffer.from(await photo.arrayBuffer()), { limitInputPixels: 24_000_000 })
        .rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
    } catch { return json({ error: 'invalid_photo' }, 400) }
    release = await (process.env.NODE_ENV === 'production' ? reserveProductionAvatar(access.supabase, access.userId) : reserveAvatarGeneration(access.userId))
    const reference = await readFile(path.join(process.cwd(), 'public/play/avatars/starter.png'))
    const bytes = await generateAvatar(new Blob([new Uint8Array(clean)], { type: 'image/jpeg' }), new Blob([new Uint8Array(reference)], { type: 'image/png' }), key)
    const id = await (process.env.NODE_ENV === 'production' ? saveProductionAvatar(access.supabase, access.userId, bytes) : saveLocalAvatar(access.userId, bytes))
    return json({ outfit: `custom:${id}` })
  } catch (error) {
    if (error instanceof AvatarGenerationError) return json({ error: error.code }, error.status)
    return json({ error: 'generation_failed' }, 500)
  } finally { await release?.() }
}
