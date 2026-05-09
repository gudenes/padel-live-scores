// src/components/road-to-olympics/BeatsFeedTabs.tsx
'use client'

import { GREEN, MUTED } from '@/components/home/shared-constants'

interface Props {
  winsLabel: string
  watchlistLabel: string
}

export default function BeatsFeedTabs({ winsLabel, watchlistLabel }: Props) {
  // Soft Launch: tab swap is visual-only. Watchlist content lights up in
  // Hardening Wave when articles.tone is populated.
  return (
    <div style={{
      display: 'flex',
      gap: 14,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      marginBottom: 10,
      paddingBottom: 6,
    }}>
      <span style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 700,
        paddingBottom: 4,
        color: GREEN,
        borderBottom: `2px solid ${GREEN}`,
        marginBottom: -7,
      }}>
        {winsLabel}
      </span>
      <span
        title="Available soon"
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 700,
          paddingBottom: 4,
          color: MUTED,
          cursor: 'not-allowed',
        }}
      >
        {watchlistLabel}
      </span>
    </div>
  )
}
