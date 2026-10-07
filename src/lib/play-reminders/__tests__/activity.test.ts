import { it, expect } from 'vitest'
import { hasRecentAppActivity } from '../activity'
const now = Date.parse('2026-10-07T12:00:00Z')
it('suppresses recently opened apps including the boundary and future clock values', () => {
  expect(hasRecentAppActivity('2026-10-07T11:45:00Z', now)).toBe(true)
  expect(hasRecentAppActivity('2026-10-07T11:30:00Z', now)).toBe(true)
  expect(hasRecentAppActivity('2026-10-07T11:29:59Z', now)).toBe(false)
  expect(hasRecentAppActivity('2026-10-07T12:05:00Z', now)).toBe(true)
})
it('missing/invalid foreground records do not pretend a user has visited', () => {
  expect(hasRecentAppActivity(null, now)).toBe(false)
  expect(hasRecentAppActivity(undefined, now)).toBe(false)
  expect(hasRecentAppActivity('invalid', now)).toBe(false)
})
