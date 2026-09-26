import { describe, it, expect } from 'vitest'
import { buildProjectionQuery } from '../projection-url'

describe('buildProjectionQuery', () => {
  it('builds a tab+category query with no pair', () => {
    expect(buildProjectionQuery('men', null)).toBe('?tab=entries&category=men')
  })

  it('builds a tab+category query for women', () => {
    expect(buildProjectionQuery('women', null)).toBe('?tab=entries&category=women')
  })

  it('appends the pair slug when present', () => {
    expect(buildProjectionQuery('men', 'arce-tello')).toBe('?tab=entries&category=men&pair=arce-tello')
  })

  it('omits the pair param when slug is empty string', () => {
    expect(buildProjectionQuery('men', '')).toBe('?tab=entries&category=men')
  })

  it('url-encodes a slug with unusual characters', () => {
    expect(buildProjectionQuery('men', 'a b')).toBe('?tab=entries&category=men&pair=a%20b')
  })
})
