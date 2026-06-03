// src/lib/ad-banner-resolver.ts
// DB-backed ad banner types + pure resolver. Replaces the old code config.

export type AdSlotId = 'sticky-bottom'

export interface AdBanner {
  id: string
  name: string
  country_codes: string[] // empty array = global default
  slot: string
  image_url: string
  click_url: string
  active: boolean
  weight: number
}

export interface AdNetworkConfig {
  web_enabled: boolean
  adsense_publisher_id: string | null
  adsense_slot_id: string | null
  native_enabled: boolean
  admob_ios_app_id: string | null
  admob_android_app_id: string | null
  admob_banner_unit_id: string | null      // Android banner unit
  admob_ios_banner_unit_id: string | null  // iOS banner unit
}

/**
 * Choose a banner for the visitor's country: exact-country candidates win;
 * else the global-default candidates; else null. Within the chosen set, pick
 * a weighted-random banner. `rand` is injectable for deterministic tests.
 */
export function pickBanner(
  banners: AdBanner[],
  country: string | null,
  rand: () => number = Math.random,
): AdBanner | null {
  const active = banners.filter((b) => b.active)
  const cc = (country ?? '').toUpperCase()
  // Exact-country candidates (the banner's country list includes the visitor's
  // country); else global-default candidates (empty country list).
  let set = cc ? active.filter((b) => b.country_codes.includes(cc)) : []
  if (set.length === 0) set = active.filter((b) => b.country_codes.length === 0)
  if (set.length === 0) return null

  const total = set.reduce((sum, b) => sum + Math.max(1, b.weight), 0)
  let r = rand() * total
  for (const b of set) {
    r -= Math.max(1, b.weight)
    if (r < 0) return b
  }
  return set[set.length - 1]
}
