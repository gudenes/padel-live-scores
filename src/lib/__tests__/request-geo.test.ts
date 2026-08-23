import { describe, it, expect } from 'vitest'
import { resolveRequestGeo } from '../request-geo'

function headers(init: Record<string, string>) {
  return new Headers(init)
}

describe('resolveRequestGeo', () => {
  it('prefers CF-IPCountry over x-vercel-ip-country', () => {
    const geo = resolveRequestGeo(headers({
      'cf-ipcountry': 'ES',
      'x-vercel-ip-country': 'US',
    }))
    expect(geo.country).toBe('ES')
  })

  it('falls back to x-vercel-ip-country when CF is missing', () => {
    const geo = resolveRequestGeo(headers({ 'x-vercel-ip-country': 'BR' }))
    expect(geo.country).toBe('BR')
  })

  it('treats CF-IPCountry XX as unknown', () => {
    const geo = resolveRequestGeo(headers({ 'cf-ipcountry': 'XX' }))
    expect(geo.country).toBeNull()
  })

  it('treats CF-IPCountry T1 (Tor exit) as unknown', () => {
    const geo = resolveRequestGeo(headers({ 'cf-ipcountry': 'T1' }))
    expect(geo.country).toBeNull()
  })

  it('falls back to x-vercel-ip-country when CF reports T1', () => {
    const geo = resolveRequestGeo(headers({
      'cf-ipcountry': 'T1',
      'x-vercel-ip-country': 'PT',
    }))
    expect(geo.country).toBe('PT')
  })

  it('prefers cf-timezone over x-vercel-ip-timezone', () => {
    const geo = resolveRequestGeo(headers({
      'cf-ipcountry': 'ES',
      'cf-timezone': 'Europe/Madrid',
      'x-vercel-ip-timezone': 'America/Los_Angeles',
    }))
    expect(geo.timezone).toBe('Europe/Madrid')
  })

  it('prefers x-vercel-ip-timezone when present', () => {
    const geo = resolveRequestGeo(headers({
      'cf-ipcountry': 'US',
      'x-vercel-ip-timezone': 'America/Los_Angeles',
    }))
    expect(geo.timezone).toBe('America/Los_Angeles')
  })

  it('maps country → IANA tz when no timezone header exists', () => {
    const geo = resolveRequestGeo(headers({ 'cf-ipcountry': 'ES' }))
    expect(geo.timezone).toBe('Europe/Madrid')
  })

  it('yields a null timezone for a country absent from the tz map', () => {
    // AQ (Antarctica) is a valid ISO code we deliberately don't map — the
    // country still resolves, the timezone stays null.
    const geo = resolveRequestGeo(headers({ 'cf-ipcountry': 'AQ' }))
    expect(geo.country).toBe('AQ')
    expect(geo.timezone).toBeNull()
  })

  it('returns nulls when no geo headers are present', () => {
    expect(resolveRequestGeo(headers({}))).toEqual({ country: null, timezone: null })
  })
})
