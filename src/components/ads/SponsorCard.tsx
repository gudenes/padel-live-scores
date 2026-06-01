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

const BLUE = '#3b82f6'
const MUTED = '#6B7280'

export function SponsorCard({
  sponsor,
  slot,
  variant,
  matchId,
}: {
  sponsor: Sponsor
  slot: AdSlotId
  variant: 'feed' | 'detail'
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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textDecoration: 'none',
        color: 'inherit',
        background: 'linear-gradient(135deg, #1e293b, #0b1220)',
        border: '1px solid rgba(59,130,246,0.35)',
        borderRadius: 12,
        padding: isFeed ? '12px 14px' : '10px 12px',
        margin: isFeed ? '6px 8px' : '12px',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sponsor.creativeImage}
        alt={sponsor.name}
        width={isFeed ? 44 : 36}
        height={isFeed ? 44 : 36}
        style={{ borderRadius: 8, flexShrink: 0, objectFit: 'cover' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 8,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: MUTED,
            fontWeight: 700,
          }}
        >
          Sponsored
        </div>
        <div style={{ fontSize: isFeed ? 14 : 13, fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>
          {sponsor.name}
        </div>
        <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 1 }}>{sponsor.headline}</div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: BLUE, flexShrink: 0 }}>
        {sponsor.ctaText} {'→'}
      </span>
    </a>
  )
}
