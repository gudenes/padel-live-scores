import { describe, it, expect } from 'vitest'
import { parseUserAgentDeviceClass, readDeviceClassCookie } from '../device-class'

describe('parseUserAgentDeviceClass', () => {
  it('returns "mobile" for an iPhone UA', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    expect(parseUserAgentDeviceClass(ua)).toBe('mobile')
  })

  it('returns "mobile" for an Android phone UA', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36'
    expect(parseUserAgentDeviceClass(ua)).toBe('mobile')
  })

  it('returns "mobile" for an iPad UA (tablets ride mobile per spec)', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    expect(parseUserAgentDeviceClass(ua)).toBe('mobile')
  })

  it('returns "desktop" for a macOS Safari UA', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
    expect(parseUserAgentDeviceClass(ua)).toBe('desktop')
  })

  it('returns "desktop" for a Windows Chrome UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(parseUserAgentDeviceClass(ua)).toBe('desktop')
  })

  it('returns "unknown" for an empty UA', () => {
    expect(parseUserAgentDeviceClass('')).toBe('unknown')
  })
})

describe('readDeviceClassCookie', () => {
  it('returns "mobile" when cookie says mobile', () => {
    expect(readDeviceClassCookie('foo=bar; device-class=mobile; baz=qux')).toBe('mobile')
  })
  it('returns "desktop" when cookie says desktop', () => {
    expect(readDeviceClassCookie('device-class=desktop')).toBe('desktop')
  })
  it('returns "unknown" when cookie is missing', () => {
    expect(readDeviceClassCookie('foo=bar')).toBe('unknown')
  })
  it('returns "unknown" when cookie is empty', () => {
    expect(readDeviceClassCookie('')).toBe('unknown')
  })
  it('returns "unknown" when cookie has an unrecognized value', () => {
    expect(readDeviceClassCookie('device-class=watchos')).toBe('unknown')
  })
})
