import { describe, it, expect } from 'vitest'
import { buildWritablePayload } from '@/types/managed-events'

describe('buildWritablePayload', () => {
  it('whitelists writable columns and drops unknowns', () => {
    const out = buildWritablePayload({ venue: 'X', evil_col: 1, active: 'yes', sort_weight: '5', watch_links: [{ url: 'u' }] })
    expect(out.venue).toBe('X')
    expect('evil_col' in out).toBe(false)
    expect(out.active).toBe(true)
    expect(out.sort_weight).toBe(5)
    expect(out.watch_links).toEqual([{ url: 'u' }])
  })
  it('defaults badge_label to Event when absent', () => {
    expect(buildWritablePayload({}).badge_label).toBe('Event')
  })
})
