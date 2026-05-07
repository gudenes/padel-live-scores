// src/lib/device-class.ts
// Pure helpers for device-class detection.
//
// We ship a `device-class` cookie from src/proxy.ts on every request so
// the first SSR paint can render a layout close to what the client will
// see, instead of always defaulting to mobile and re-rendering on mount.
// The cookie is a coarse hint — `useIsDesktop()` confirms via `window.matchMedia`
// once the client is alive.

export type DeviceClass = 'mobile' | 'desktop' | 'unknown'

export function parseUserAgentDeviceClass(userAgent: string): DeviceClass {
  if (!userAgent) return 'unknown'
  const ua = userAgent.toLowerCase()
  // Tablets count as mobile per spec — we don't ship a tablet hybrid.
  if (/iphone|ipad|ipod|android|mobile|opera mini|iemobile|blackberry|webos/.test(ua)) {
    return 'mobile'
  }
  if (/macintosh|windows|x11|linux/.test(ua)) {
    return 'desktop'
  }
  return 'unknown'
}

export function readDeviceClassCookie(cookieHeader: string): DeviceClass {
  if (!cookieHeader) return 'unknown'
  const match = cookieHeader.split(/;\s*/).find(c => c.startsWith('device-class='))
  if (!match) return 'unknown'
  const value = match.slice('device-class='.length)
  if (value === 'mobile' || value === 'desktop') return value
  return 'unknown'
}
