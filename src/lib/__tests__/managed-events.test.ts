import { describe, it, expect } from 'vitest'
import {
  effectiveStatus,
  isValidSlug,
  managedEventToCarouselCard,
  type ManagedEvent,
} from '@/lib/managed-events'

const base: ManagedEvent = {
  id: 'e1',
  slug: 'reserve-cup-marbella-2026',
  name: 'Reserve Cup',
  wordmark: 'RC26',
  badge_label: 'Exhibition',
  active: true,
  status_override: null,
  country: 'ES',
  location: 'Marbella',
  venue: 'Puente Romano',
  starts_at: '2026-06-18T00:00:00.000Z',
  ends_at: '2026-06-20T23:59:59.000Z',
  prize_pool: '$1.7M',
  cover_image_url: null,
  ticket_url: null,
  footnote: null,
  watch_links: [],
  divisions: [],
  format: {},
  results: null,
  sort_weight: 0,
}

describe('effectiveStatus', () => {
  it('returns the override when set', () => {
    expect(effectiveStatus({ ...base, status_override: 'finished' }, new Date('2026-06-01T00:00:00Z'))).toBe('finished')
  })
  it('upcoming before starts_at', () => {
    expect(effectiveStatus(base, new Date('2026-06-17T12:00:00Z'))).toBe('upcoming')
  })
  it('ongoing within the window', () => {
    expect(effectiveStatus(base, new Date('2026-06-19T12:00:00Z'))).toBe('ongoing')
  })
  it('finished after ends_at', () => {
    expect(effectiveStatus(base, new Date('2026-06-21T12:00:00Z'))).toBe('finished')
  })
  it('upcoming when dates are missing', () => {
    expect(effectiveStatus({ ...base, starts_at: null, ends_at: null }, new Date())).toBe('upcoming')
  })
})

describe('isValidSlug', () => {
  it('accepts kebab-case', () => {
    expect(isValidSlug('reserve-cup-marbella-2026')).toBe(true)
  })
  it('rejects spaces, uppercase, leading/trailing dashes', () => {
    expect(isValidSlug('Reserve Cup')).toBe(false)
    expect(isValidSlug('-bad')).toBe(false)
    expect(isValidSlug('bad-')).toBe(false)
    expect(isValidSlug('')).toBe(false)
  })
})

describe('managedEventToCarouselCard', () => {
  it('maps to a carousel card with the managedEvent discriminator', () => {
    const card = managedEventToCarouselCard(base)
    expect(card.id).toBe('e1')
    expect(card.name).toBe('Reserve Cup')
    expect(card.level).toBeNull()
    expect(card.managedEvent).toEqual({ slug: 'reserve-cup-marbella-2026', badgeLabel: 'Exhibition' })
  })
})
