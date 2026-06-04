// src/lib/admob-eligibility.ts
// Pure helpers for the native AdMob banner controller. No Capacitor imports —
// safe to unit-test and to import anywhere.

/** Routes where the web sticky slot is allowed (locale-stripped paths).
 *  Mirrors StickyAdBanner's matcher — used for the direct-sponsor banner. */
export function isAdRoute(pathname: string): boolean {
  return /^\/(matches(\/|$)|match\/|player\/)/.test(pathname)
}

/** Match-detail route only (locale-stripped, e.g. "/match/abc"). The native
 *  AdMob banner is scoped to this page, which renders no bottom nav — so the
 *  bottom-anchored overlay never collides with the nav (no margin/patch needed). */
export function isMatchDetailRoute(pathname: string): boolean {
  return /^\/match\//.test(pathname)
}

export function shouldShowAdMob(args: {
  isNative: boolean
  pathname: string
  hasDirectBanner: boolean
  networkNativeEnabled: boolean
}): boolean {
  const { isNative, pathname, hasDirectBanner, networkNativeEnabled } = args
  return isNative && isMatchDetailRoute(pathname) && !hasDirectBanner && networkNativeEnabled
}

/** The AdMob banner ad-unit id for the running platform, or null if unset. */
export function pickBannerUnit(
  platform: 'ios' | 'android' | string,
  cfg: { admob_banner_unit_id: string | null; admob_ios_banner_unit_id: string | null },
): string | null {
  if (platform === 'ios') return cfg.admob_ios_banner_unit_id || null
  if (platform === 'android') return cfg.admob_banner_unit_id || null
  return null
}
