// src/components/ads/AdSlot.tsx
'use client'

import { getActiveSponsor, type AdSlotId } from '@/lib/sponsors'
import { SponsorCard } from './SponsorCard'
import { NetworkAdSlot } from './NetworkAdSlot'

/**
 * Placeholder ad slot. Resolves the active direct sponsor for `slot`; if one
 * exists it renders the SponsorCard creative, otherwise it falls through to
 * the (currently stubbed) NetworkAdSlot seam for AdSense/AdMob.
 */
export function AdSlot({
  slot,
  variant,
  context,
}: {
  slot: AdSlotId
  variant: 'feed' | 'detail'
  context?: { matchId?: string }
}) {
  const sponsor = getActiveSponsor(slot)
  if (sponsor) {
    return (
      <SponsorCard
        sponsor={sponsor}
        slot={slot}
        variant={variant}
        matchId={context?.matchId}
      />
    )
  }
  return <NetworkAdSlot slot={slot} variant={variant} />
}
