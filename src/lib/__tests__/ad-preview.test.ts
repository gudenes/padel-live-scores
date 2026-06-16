import { describe, it, expect } from 'vitest'
import { pickPreviewId } from '@/lib/ad-preview'

describe('pickPreviewId', () => {
  it('prefers the URL param over the stored value', () => {
    expect(pickPreviewId('url-id', 'stored-id')).toBe('url-id')
  })

  it('falls back to the stored value when no URL param', () => {
    expect(pickPreviewId(null, 'stored-id')).toBe('stored-id')
  })

  it('returns null when neither is present', () => {
    expect(pickPreviewId(null, null)).toBeNull()
  })

  it('treats empty / whitespace as absent', () => {
    expect(pickPreviewId('  ', '')).toBeNull()
    expect(pickPreviewId('', 'stored-id')).toBe('stored-id')
    expect(pickPreviewId('  url-id  ', null)).toBe('url-id')
  })
})
