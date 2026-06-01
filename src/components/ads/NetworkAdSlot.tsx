// src/components/ads/NetworkAdSlot.tsx
'use client'

import type { AdSlotId } from '@/lib/sponsors'

/**
 * Programmatic-network fill seam. Rendered by AdSlot when no direct sponsor is
 * assigned to a slot. Renders nothing today — this is the integration point
 * for AdSense (web) / AdMob (native Capacitor).
 *
 * When wiring a network later:
 *   - Detect platform (web vs Capacitor native).
 *   - TODO(ads-network): web  -> mount an AdSense unit keyed by `slot`.
 *   - TODO(ads-network): native -> mount an AdMob banner keyed by `slot`.
 * Keep this component's external contract (props) stable so AdSlot does not
 * need to change when networks are added.
 */
export function NetworkAdSlot(props: {
  slot: AdSlotId
  variant: 'feed' | 'detail'
}) {
  // Props are intentionally unused until a network is wired (see TODOs above).
  void props
  return null
}
