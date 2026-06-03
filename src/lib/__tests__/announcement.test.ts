// src/lib/__tests__/announcement.test.ts
import { describe, it, expect } from 'vitest'
import {
  selectActiveAnnouncement,
  dismissalKey,
  isDismissed,
  type Announcement,
} from '@/lib/announcement'

const base: Announcement = {
  id: 'a1',
  title: null,
  message: 'Matches suspended',
  type: 'warning',
  active: true,
  starts_at: null,
  expires_at: null,
  updated_at: '2026-06-03T10:00:00.000Z',
}
const NOW = Date.parse('2026-06-03T12:00:00.000Z')

describe('selectActiveAnnouncement', () => {
  it('returns null when no rows', () => {
    expect(selectActiveAnnouncement([], NOW)).toBeNull()
  })

  it('returns the row when active and no time window', () => {
    expect(selectActiveAnnouncement([base], NOW)?.id).toBe('a1')
  })

  it('excludes rows that are not yet started', () => {
    const future = { ...base, starts_at: '2026-06-03T18:00:00.000Z' }
    expect(selectActiveAnnouncement([future], NOW)).toBeNull()
  })

  it('excludes rows that have expired', () => {
    const past = { ...base, expires_at: '2026-06-03T11:00:00.000Z' }
    expect(selectActiveAnnouncement([past], NOW)).toBeNull()
  })

  it('includes a row inside its window', () => {
    const windowed = {
      ...base,
      starts_at: '2026-06-03T09:00:00.000Z',
      expires_at: '2026-06-03T18:00:00.000Z',
    }
    expect(selectActiveAnnouncement([windowed], NOW)?.id).toBe('a1')
  })

  it('picks the newest updated_at among eligible rows', () => {
    const older = { ...base, id: 'old', updated_at: '2026-06-03T08:00:00.000Z' }
    const newer = { ...base, id: 'new', updated_at: '2026-06-03T11:30:00.000Z' }
    expect(selectActiveAnnouncement([older, newer], NOW)?.id).toBe('new')
  })
})

describe('dismissal', () => {
  it('builds a key from id and updated_at', () => {
    expect(dismissalKey(base)).toBe('a1:2026-06-03T10:00:00.000Z')
  })

  it('is dismissed only when the stored key matches exactly', () => {
    expect(isDismissed(base, 'a1:2026-06-03T10:00:00.000Z')).toBe(true)
    expect(isDismissed(base, 'a1:2026-06-03T09:00:00.000Z')).toBe(false) // copy edited → re-show
    expect(isDismissed(base, null)).toBe(false)
    expect(isDismissed(base, 'garbage')).toBe(false)
  })
})
