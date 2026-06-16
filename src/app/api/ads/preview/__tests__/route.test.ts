import { describe, it, expect } from 'vitest'
import { parsePreviewId } from '../route'

describe('parsePreviewId', () => {
  it('returns the trimmed id', () => {
    expect(parsePreviewId('abc-123')).toBe('abc-123')
    expect(parsePreviewId('  abc-123  ')).toBe('abc-123')
  })

  it('returns null for missing / empty input', () => {
    expect(parsePreviewId(null)).toBeNull()
    expect(parsePreviewId('')).toBeNull()
    expect(parsePreviewId('   ')).toBeNull()
  })
})
