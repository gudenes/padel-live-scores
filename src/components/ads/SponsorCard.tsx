// src/components/ads/SponsorCard.tsx
'use client'

import { useEffect, useRef } from 'react'
import type { AdSlotId, Sponsor } from '@/lib/sponsors'

function trackImpression(slot: AdSlotId, sponsorId: string) {
  void fetch('/api/ads/impression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, sponsorId }),
    keepalive: true,
  }).catch(() => {})
}

function trackClick(slot: AdSlotId, sponsorId: string, matchId?: string) {
  void fetch('/api/ads/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, sponsorId, matchId: matchId ?? null }),
    keepalive: true,
  }).catch(() => {})
}

/**
 * Full-width brand banner. Renders the sponsor's complete creative image
 * (320x50, 6.4:1) edge-to-edge, like the banner ads in other live-score apps.
 * A small "Ad" disclosure tag sits in the corner. Click + impression tracked.
 */
export function SponsorCard({
  sponsor,
  slot,
  variant,
  matchId,
}: {
  sponsor: Sponsor
  slot: AdSlotId
  variant: 'feed' | 'detail' | 'sticky'
  matchId?: string
}) {
  // Fire one impression per mount. Guard against React 18/19 StrictMode
  // double-invocation in dev.
  const impressionFired = useRef(false)
  useEffect(() => {
    if (impressionFired.current) return
    impressionFired.current = true
    trackImpression(slot, sponsor.id)
  }, [slot, sponsor.id])

  const isFeed = variant === 'feed'

  return (
    <a
      href={sponsor.url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => trackClick(slot, sponsor.id, matchId)}
      data-ad-slot={slot}
      aria-label={`${sponsor.name} (sponsored)`}
      style={{
        position: 'relative',
        display: 'block',
        margin: variant === 'sticky' ? 0 : isFeed ? '6px 8px' : '12px',
        borderRadius: variant === 'sticky' ? 0 : 8,
        overflow: 'hidden',
        background: '#0b1220',
        lineHeight: 0,
      }}
    >
      {/* Full creative — the image carries the whole brand. width:100% keeps it
          edge-to-edge; height:auto preserves the supplied 320x50 ratio. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sponsor.bannerImage}
        alt={sponsor.name}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
      {/* Ad-disclosure tag (transparency best practice) */}
      <span
        style={{
          position: 'absolute',
          top: 3,
          right: 3,
          fontSize: 7,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: '#e5e7eb',
          background: 'rgba(0,0,0,0.5)',
          padding: '1px 4px',
          borderRadius: 3,
          fontWeight: 700,
          lineHeight: 1.4,
        }}
      >
        Ad
      </span>
    </a>
  )
}
