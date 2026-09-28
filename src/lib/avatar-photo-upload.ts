import { AVATAR_UPLOAD_MAX_PIXELS } from './avatar-upload'

export class AvatarUploadError extends Error {}

export async function prepareAvatarPhoto(file: File, signal: AbortSignal): Promise<Blob> {
  // Resizing is a bandwidth optimization. Mobile WebViews can fail to
  // decode/canvas-export a file that the server's image decoder accepts.
  try { return await resizeAvatarPhoto(file, signal) }
  catch (error) {
    if (signal.aborted) throw error
    return file
  }
}

async function resizeAvatarPhoto(file: File, signal: AbortSignal): Promise<Blob> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null }
      const fail = () => { cleanup(); reject(new AvatarUploadError('invalid_photo')) }
      const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
      const timer = setTimeout(fail, 20000)
      image.onload = () => { cleanup(); resolve() }
      image.onerror = fail
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      image.src = url
    })
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > AVATAR_UPLOAD_MAX_PIXELS) throw new AvatarUploadError('invalid_photo')
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new AvatarUploadError('invalid_photo')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      canvas.width = canvas.height = 0
      if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'))
      else if (blob) resolve(blob)
      else reject(new AvatarUploadError('invalid_photo'))
    }, 'image/jpeg', .9))
  } finally { image.src = ''; URL.revokeObjectURL(url) }
}

export async function uploadAvatarPhoto(photo: Blob, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const form = new FormData()
  form.set('photo', photo, 'portrait.jpg'); form.set('consent', 'true')
  let response: Response
  try { response = await fetcher('/api/play/avatar', { method: 'POST', body: form, signal }) }
  catch { throw new AvatarUploadError('upload_connection') }
  const result = await response.json().catch(() => null) as { error?: string; outfit?: string } | null
  if (!response.ok) {
    const known = ['not_configured', 'daily_limit', 'generation_busy', 'provider_busy', 'invalid_photo', 'photo_too_large', 'generation_failed', 'generation_unavailable']
    if (result?.error && known.includes(result.error)) throw new AvatarUploadError(result.error)
    if (response.status === 413) throw new AvatarUploadError('photo_too_large')
    if ([408, 504, 524].includes(response.status)) throw new AvatarUploadError('upload_timeout')
    if ([401, 403, 404].includes(response.status)) throw new AvatarUploadError('upload_session')
    throw new AvatarUploadError('upload_connection')
  }
  if (!result?.outfit) throw new AvatarUploadError('generation_failed')
  return result.outfit
}
