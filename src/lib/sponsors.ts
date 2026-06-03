// src/lib/sponsors.ts
// Config-driven sponsor registry. Sponsor *definitions* live in code (no DB);
// only engagement (clicks/impressions) is persisted. Adding a partner = add an
// entry here. Weighted rotation across multiple sponsors is a later extension.

export type AdSlotId = 'sticky-bottom'

export interface Sponsor {
  id: string
  name: string
  /** Square logo (1:1), path under /public. Reserved for future layouts. */
  creativeImage: string
  /** Full-width brand banner (320x50, 6.4:1), path under /public. The complete
   *  creative the sponsor supplies — this is what renders. */
  bannerImage: string
  headline: string
  ctaText: string
  url: string
  /** Which ad slots this sponsor is eligible to fill. */
  slots: AdSlotId[]
  /** ISO 3166-1 alpha-2 country codes this sponsor targets (e.g. ['ES']).
   *  Empty array = global (shown everywhere). Uses the same `geo-country`
   *  signal as the equipment-partners feature. */
  countries: string[]
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
    slots: ['sticky-bottom'],
    countries: ['ES'],
    weight: 1,
  },
]

/**
 * Resolve the active sponsor for a slot, optionally filtered by the visitor's
 * country. A sponsor matches when it is eligible for the slot AND either it is
 * global (empty `countries`) or its list includes the visitor's country.
 * Returns null when nothing matches (caller falls back to a network ad).
 */
export function getActiveSponsor(
  slot: AdSlotId,
  country?: string | null,
): Sponsor | null {
  const cc = (country ?? '').toUpperCase()
  const candidates = SPONSORS.filter(
    (s) =>
      s.slots.includes(slot) &&
      (s.countries.length === 0 || (cc !== '' && s.countries.includes(cc))),
  )
  return candidates.length > 0 ? candidates[0] : null
}
