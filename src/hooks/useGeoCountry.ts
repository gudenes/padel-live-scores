'use client'

import { useSyncExternalStore } from 'react'

/**
 * Reads the visitor's country (ISO alpha-2, uppercase) from the `geo-country`
 * cookie set by the Next.js proxy from Vercel's IP geolocation — the same
 * signal the equipment-partners feature uses. Returns null on the server and
 * when unknown.
 *
 * useSyncExternalStore keeps server/client snapshots consistent (server = null)
 * without a setState-in-effect. The cookie is stable for a session, so the
 * subscribe callback is a no-op.
 */
function readCountry(): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|;\s*)geo-country=([^;]+)/)
  return m ? decodeURIComponent(m[1]).toUpperCase() : null
}

const subscribe = () => () => {}

export function useGeoCountry(): string | null {
  return useSyncExternalStore(subscribe, readCountry, () => null)
}
