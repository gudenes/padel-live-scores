'use client'

// src/components/MatchesDayShimmer.tsx
//
// Skeleton shown on /matches/[date] while the client-side day cache
// fetches a not-yet-cached day. Three faux tournament groups, each with
// a pulsing chunky-card shape — matches the real layout closely enough
// that the swap doesn't shove the page when data arrives.

import React from 'react'

const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const SHIMMER_KEYFRAMES = `
@keyframes matches-shimmer-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .matches-shimmer-block { animation: none !important; }
}
`

function Block({ width, height, mt = 0 }: { width: number | string; height: number; mt?: number }) {
  return (
    <div
      className="matches-shimmer-block"
      style={{
        width,
        height,
        marginTop: mt,
        background: 'rgba(255,255,255,0.05)',
        clipPath: CHUNKY_BADGE,
        animation: 'matches-shimmer-pulse 1.4s ease-in-out infinite',
      }}
    />
  )
}

function ShimmerCard() {
  return (
    <div
      className="matches-shimmer-block"
      style={{
        padding: '12px 14px',
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        clipPath: CHUNKY_CARD,
        marginBottom: 8,
        animation: 'matches-shimmer-pulse 1.4s ease-in-out infinite',
      }}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <Block width={48} height={14} />
        <Block width={42} height={14} />
        <Block width={56} height={14} />
        <Block width={48} height={14} />
      </div>
      <Block width="60%" height={14} mt={4} />
      <Block width="50%" height={14} mt={6} />
    </div>
  )
}

function ShimmerGroup({ matchCount }: { matchCount: number }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 8px',
        }}
      >
        <div
          className="matches-shimmer-block"
          style={{
            width: 28,
            height: 22,
            background: 'rgba(255,255,255,0.06)',
            animation: 'matches-shimmer-pulse 1.4s ease-in-out infinite',
            clipPath: CHUNKY_BADGE,
          }}
        />
        <div style={{ flex: 1 }}>
          <Block width="70%" height={14} />
          <Block width="40%" height={11} mt={6} />
        </div>
        <Block width={42} height={20} />
      </div>
      {Array.from({ length: matchCount }).map((_, i) => (
        <ShimmerCard key={i} />
      ))}
    </div>
  )
}

export default function MatchesDayShimmer() {
  return (
    <div style={{ padding: '0 8px' }} aria-hidden>
      <style dangerouslySetInnerHTML={{ __html: SHIMMER_KEYFRAMES }} />
      <ShimmerGroup matchCount={3} />
      <ShimmerGroup matchCount={2} />
      <ShimmerGroup matchCount={2} />
    </div>
  )
}
