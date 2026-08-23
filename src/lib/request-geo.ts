// src/lib/request-geo.ts
//
// Resolve visitor country + IANA timezone from request headers.
// Cloudflare is preferred (post-cutover) for both country (`cf-ipcountry`)
// and timezone (`cf-timezone`). Vercel headers remain as fallback during
// the dual-origin window and for any leftover preview.

import { countryToTimezone } from './country-timezone'

export type RequestGeo = {
  country: string | null
  timezone: string | null
}

function read(headers: Headers, name: string): string {
  return (headers.get(name) ?? '').trim()
}

// Country codes Cloudflare uses for "no usable country": `XX` for unknown
// networks and `T1` for Tor exit nodes. Neither is an ISO 3166-1 code, so
// letting them through would poison the `geo-country` cookie (and the
// country → timezone lookup) with a value nothing can resolve.
const UNKNOWN_COUNTRIES = new Set(['XX', 'T1'])

function isKnownCountry(code: string): boolean {
  return code !== '' && !UNKNOWN_COUNTRIES.has(code)
}

export function resolveRequestGeo(headers: Headers): RequestGeo {
  const cfCountry = read(headers, 'cf-ipcountry').toUpperCase()
  const vercelCountry = read(headers, 'x-vercel-ip-country').toUpperCase()
  const countryRaw = isKnownCountry(cfCountry) ? cfCountry : vercelCountry
  const country = isKnownCountry(countryRaw) ? countryRaw : null

  // `cf-timezone` comes from Cloudflare's "Add visitor location headers"
  // managed transform and is the only real timezone signal we get now that
  // traffic no longer passes through Vercel's edge — without it every
  // visitor silently degrades to the coarse country-level guess below.
  const cfTz = read(headers, 'cf-timezone')
  const vercelTz = read(headers, 'x-vercel-ip-timezone')
  const timezone = cfTz || vercelTz || (country ? countryToTimezone(country) : null) || null

  return { country, timezone }
}
