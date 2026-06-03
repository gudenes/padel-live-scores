// src/components/ads/SponsorCard.tsx
'use client'

import { useEffect, useRef } from 'react'
import type { AdBanner, AdSlotId } from '@/lib/ad-banner-resolver'

function trackImpression(slot: AdSlotId, bannerId: string) {
  void fetch('/api/ads/impression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, sponsorId: bannerId }),
    keepalive: true,
  }).catch(() => {})
}

function trackClick(slot: AdSlotId, bannerId: string, matchId?: string) {
  void fetch('/api/ads/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, sponsorId: bannerId, matchId: matchId ?? null }),
    keepalive: true,
  }).catch(() => {})
}

/**
 * Full-width brand banner. Renders the banner's complete creative image
 * (320x50, 6.4:1) edge-to-edge, with a small "Ad" disclosure tag. Click +
 * impression tracked, keyed by the banner id.
 */
export function SponsorCard({
  banner,
  slot,
  variant,
  matchId,
}: {
  banner: AdBanner
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
    trackImpression(slot, banner.id)
  }, [slot, banner.id])

  const isFeed = variant === 'feed'

  return (
    <a
      href={banner.click_url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => trackClick(slot, banner.id, matchId)}
      data-ad-slot={slot}
      aria-label={`${banner.name} (sponsored)`}
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={banner.image_url}
        alt={banner.name}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          // Sticky: cap to the native 320x50 and center, so it renders at the
          // standard ~50px banner height instead of stretching to the column.
          ...(variant === 'sticky' ? { maxWidth: 320, margin: '0 auto' } : null),
        }}
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
