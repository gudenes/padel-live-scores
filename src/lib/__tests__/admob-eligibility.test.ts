import { describe, it, expect } from 'vitest'
import { shouldShowAdMob, pickBannerUnit, isAdRoute } from '@/lib/admob-eligibility'

describe('isAdRoute', () => {
  it('matches matches/match/player (locale-stripped)', () => {
    expect(isAdRoute('/matches')).toBe(true)
    expect(isAdRoute('/matches/2026-06-03')).toBe(true)
    expect(isAdRoute('/match/abc')).toBe(true)
    expect(isAdRoute('/player/abc')).toBe(true)
  })
  it('rejects other routes', () => {
    expect(isAdRoute('/')).toBe(false)
    expect(isAdRoute('/rankings')).toBe(false)
  })
})

describe('shouldShowAdMob', () => {
  const base = { isNative: true, pathname: '/matches', hasDirectBanner: false, networkNativeEnabled: true }
  it('shows when native, on an ad route, no direct banner, flag on', () => {
    expect(shouldShowAdMob(base)).toBe(true)
  })
  it('hides on web', () => {
    expect(shouldShowAdMob({ ...base, isNative: false })).toBe(false)
  })
  it('hides when a direct banner is present (direct wins)', () => {
    expect(shouldShowAdMob({ ...base, hasDirectBanner: true })).toBe(false)
  })
  it('hides when the network flag is off', () => {
    expect(shouldShowAdMob({ ...base, networkNativeEnabled: false })).toBe(false)
  })
  it('hides off-route', () => {
    expect(shouldShowAdMob({ ...base, pathname: '/rankings' })).toBe(false)
  })
})

describe('pickBannerUnit', () => {
  const cfg = { admob_banner_unit_id: 'android-unit', admob_ios_banner_unit_id: 'ios-unit' }
  it('picks the iOS unit on ios', () => {
    expect(pickBannerUnit('ios', cfg)).toBe('ios-unit')
  })
  it('picks the Android unit on android', () => {
    expect(pickBannerUnit('android', cfg)).toBe('android-unit')
  })
  it('returns null when the platform unit is missing', () => {
    expect(pickBannerUnit('ios', { admob_banner_unit_id: 'x', admob_ios_banner_unit_id: null })).toBeNull()
  })
})
