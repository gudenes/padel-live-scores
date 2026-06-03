// src/lib/sponsors.ts
// Config-driven sponsor registry. Sponsor *definitions* live in code (no DB);
// only engagement (clicks/impressions) is persisted. Adding a partner = add an
// entry here. Weighted rotation across multiple sponsors is a later extension.

export type AdSlotId = 'feed-inline' | 'match-detail-stats'

export interface Sponsor {
  id: string
  name: string
  /** Square logo (1:1), path under /public. Used by the legacy logo+text card. */
  creativeImage: string
  /** Full-width brand banner (320x50, 6.4:1), path under /public. This is the
   *  complete creative the sponsor supplies and is what renders today. */
  bannerImage: string
  headline: string
  ctaText: string
  url: string
  /** Which ad slots this sponsor is eligible to fill. */
  slots: AdSlotId[]
  /** Relative weight for future multi-sponsor rotation. */
  weight: number
}

export const SPONSORS: Sponsor[] = [
  {
    id: 'aceprogrip',
    name: 'AceProGrip',
    creativeImage: '/sponsors/aceprogrip.svg',
    bannerImage: '/sponsors/aceprogrip-banner.svg',
    headline: 'Grip like the pros',
    ctaText: 'Shop grips',
    url: 'https://www.aceprogrip.es/',
    slots: ['feed-inline', 'match-detail-stats'],
    weight: 1,
  },
]

/**
 * Resolve the active sponsor for a slot. Returns the first eligible sponsor
 * (single sponsor today). When none is assigned, returns null so the caller
 * can fall back to a network ad.
 */
export function getActiveSponsor(slot: AdSlotId): Sponsor | null {
  const candidates = SPONSORS.filter((s) => s.slots.includes(slot))
  return candidates.length > 0 ? candidates[0] : null
}
