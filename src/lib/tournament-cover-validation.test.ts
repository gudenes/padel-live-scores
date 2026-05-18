import { describe, it, expect } from 'vitest'
import {
  validateCoverFile,
  COVER_MAX_BYTES,
  COVER_ALLOWED_MIMES,
} from './tournament-cover-validation'

function fakeFile(type: string, size: number, name = 'cover.jpg'): File {
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type })
}

describe('validateCoverFile', () => {
  it('accepts a 2 MB JPEG', () => {
    const result = validateCoverFile(fakeFile('image/jpeg', 2 * 1024 * 1024))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ext).toBe('jpg')
  })

  it('accepts a PNG', () => {
    const result = validateCoverFile(fakeFile('image/png', 1024))
    expect(result.ok).toBe(true)
  })

  it('accepts a WebP', () => {
    const result = validateCoverFile(fakeFile('image/webp', 1024))
    expect(result.ok).toBe(true)
  })

  it('rejects a PDF', () => {
    const result = validateCoverFile(fakeFile('application/pdf', 1024))
    expect(result).toEqual({ ok: false, status: 400, error: 'unsupported_mime' })
  })

  it('rejects a GIF', () => {
    const result = validateCoverFile(fakeFile('image/gif', 1024))
    expect(result.ok).toBe(false)
  })

  it('rejects a 6 MB JPEG', () => {
    const result = validateCoverFile(fakeFile('image/jpeg', 6 * 1024 * 1024))
    expect(result).toEqual({ ok: false, status: 413, error: 'too_large' })
  })

  it('rejects a missing file', () => {
    const result = validateCoverFile(null)
    expect(result).toEqual({ ok: false, status: 400, error: 'missing_file' })
  })

  it('exports the limits as constants', () => {
    expect(COVER_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(COVER_ALLOWED_MIMES).toContain('image/jpeg')
    expect(COVER_ALLOWED_MIMES).toContain('image/png')
    expect(COVER_ALLOWED_MIMES).toContain('image/webp')
  })
})
