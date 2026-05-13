import { describe, it, expect } from 'vitest'
import { pickExtension, isSupabaseHosted } from '../equipment-image-rehost'

describe('pickExtension', () => {
  it('returns svg for image/svg+xml', () => {
    expect(pickExtension('image/svg+xml')).toBe('svg')
  })
  it('returns png for image/png', () => {
    expect(pickExtension('image/png')).toBe('png')
  })
  it('returns webp for image/webp', () => {
    expect(pickExtension('image/webp')).toBe('webp')
  })
  it('returns gif for image/gif', () => {
    expect(pickExtension('image/gif')).toBe('gif')
  })
  it('returns jpg for image/jpeg', () => {
    expect(pickExtension('image/jpeg')).toBe('jpg')
  })
  it('returns jpg for image/jpg (non-canonical)', () => {
    expect(pickExtension('image/jpg')).toBe('jpg')
  })
  it('falls back to jpg for unknown content types', () => {
    expect(pickExtension('application/octet-stream')).toBe('jpg')
  })
})

describe('isSupabaseHosted', () => {
  it('returns true for a Supabase Storage URL', () => {
    expect(isSupabaseHosted('https://jwqaesjjoghzobngxejn.supabase.co/storage/v1/object/public/equipment/brand-x.png')).toBe(true)
  })
  it('returns false for an external CDN URL', () => {
    expect(isSupabaseHosted('https://cdn.shopify.com/foo.png')).toBe(false)
  })
  it('returns false for null', () => {
    expect(isSupabaseHosted(null)).toBe(false)
  })
  it('returns false for undefined', () => {
    expect(isSupabaseHosted(undefined)).toBe(false)
  })
  it('returns false for empty string', () => {
    expect(isSupabaseHosted('')).toBe(false)
  })
})
