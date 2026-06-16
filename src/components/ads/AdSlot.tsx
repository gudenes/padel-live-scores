// src/components/ads/AdSlot.tsx
'use client'

import type { AdBanner, AdSlotId } from '@/lib/ad-banner-resolver'
import { SponsorCard } from './SponsorCard'
import { NetworkAdSlot } from './NetworkAdSlot'

/**
 * Renders a resolved banner (direct sponsor) or falls through to the stubbed
 * NetworkAdSlot seam. Resolution (country + weighted rotation) happens upstream
 * in the caller via pickBanner().
 */
export function AdSlot({
  slot,
  variant,
  banner,
  context,
  preview = false,
}: {
  slot: AdSlotId
  variant: 'feed' | 'detail' | 'sticky'
  banner: AdBanner | null
  context?: { matchId?: string }
  preview?: boolean
}) {
  if (banner) {
    return <SponsorCard banner={banner} slot={slot} variant={variant} matchId={context?.matchId} preview={preview} />
  }
  return <NetworkAdSlot slot={slot} variant={variant} />
}
