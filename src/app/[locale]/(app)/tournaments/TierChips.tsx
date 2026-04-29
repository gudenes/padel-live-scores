'use client'

// Tier filter chips — single-select for v1 ("Todas" or one bucket).
// State lives in the URL via `?tier=premier` so reloads + deep-links
// preserve the filter. Phase 2 turns this into multi-select and adds
// the "Siguiendo" personalised filter.

import { useRouter, usePathname } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import { GREEN, BG_CARD, BORDER, CHUNKY } from '@/components/home/shared'
import type { TierBucket } from './types'

interface ChipDef {
  bucket: TierBucket
  label: string
}

const CHIPS: ChipDef[] = [
  { bucket: 'all', label: 'Todas' },
  { bucket: 'premier', label: 'Premier' },
  { bucket: 'fip_top', label: 'FIP Top' },
  { bucket: 'fip_mid', label: 'FIP Mid' },
  { bucket: 'fip_base', label: 'FIP Base' },
  // 'following' chip lives in Phase 2 once the bookmark integration
  // lands. We don't render an inactive ⭐ pill yet to avoid teasing
  // a feature that doesn't work.
]

interface TierChipsProps {
  activeBucket: TierBucket
}

export default function TierChips({ activeBucket }: TierChipsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setBucket = (bucket: TierBucket) => {
    const params = new URLSearchParams(searchParams.toString())
    if (bucket === 'all') {
      params.delete('tier')
    } else {
      params.set('tier', bucket)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '12px 16px 4px',
        overflowX: 'auto',
        background: '#1A1A1A',
        scrollbarWidth: 'none',
      }}
      // Hide horizontal scrollbar on webkit
      className="tier-chips-scroll"
    >
      <style>{`.tier-chips-scroll::-webkit-scrollbar { display: none; }`}</style>
      {CHIPS.map(({ bucket, label }) => {
        const active = bucket === activeBucket
        return (
          <button
            key={bucket}
            type="button"
            onClick={() => setBucket(bucket)}
            style={{
              flexShrink: 0,
              padding: '7px 14px',
              background: active ? GREEN : BG_CARD,
              border: `1px solid ${active ? GREEN : BORDER}`,
              color: active ? '#0A0A0A' : '#B5B5B5',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.02em',
              clipPath: CHUNKY.button,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontFamily: 'inherit',
            }}
          >
            {active && <span style={{ fontSize: 10 }}>✓</span>}
            {label}
          </button>
        )
      })}
    </div>
  )
}
