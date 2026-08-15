// src/lib/request-geo.ts
//
// Resolve visitor country + IANA timezone from request headers.
// Cloudflare is preferred (post-cutover). Vercel headers remain as
// fallback during the dual-origin window and for any leftover preview.

import { countryToTimezone } from './country-timezone'

export type RequestGeo = {
  country: string | null
  timezone: string | null
}

function read(headers: Headers, name: string): string {
  return (headers.get(name) ?? '').trim()
}

export function resolveRequestGeo(headers: Headers): RequestGeo {
  const cfCountry = read(headers, 'cf-ipcountry').toUpperCase()
  const vercelCountry = read(headers, 'x-vercel-ip-country').toUpperCase()
  const countryRaw = cfCountry && cfCountry !== 'XX' ? cfCountry : vercelCountry
  const country = countryRaw && countryRaw !== 'XX' ? countryRaw : null

  const vercelTz = read(headers, 'x-vercel-ip-timezone')
  const timezone = vercelTz || (country ? countryToTimezone(country) : null) || null

  return { country, timezone }
}
