export const COVER_MAX_BYTES = 5 * 1024 * 1024
export const COVER_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type CoverValidationResult =
  | { ok: true; ext: 'jpg' | 'png' | 'webp' }
  | { ok: false; status: 400 | 413; error: 'missing_file' | 'unsupported_mime' | 'too_large' }

const MIME_TO_EXT: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function validateCoverFile(file: File | null): CoverValidationResult {
  if (!file) return { ok: false, status: 400, error: 'missing_file' }
  if (!(COVER_ALLOWED_MIMES as readonly string[]).includes(file.type)) {
    return { ok: false, status: 400, error: 'unsupported_mime' }
  }
  if (file.size > COVER_MAX_BYTES) {
    return { ok: false, status: 413, error: 'too_large' }
  }
  return { ok: true, ext: MIME_TO_EXT[file.type] }
}
