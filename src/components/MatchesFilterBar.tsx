'use client'

// src/components/MatchesFilterBar.tsx
//
// Sticky bar that lives between the day-pills row and the match list.
// Just a right-aligned "Filters" button with an active-count badge —
// the summary line that used to sit on the left was removed because
// it read defaults back to the user without adding signal.

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { type MatchesFilters } from '@/hooks/useMatchesFilters'

const GREEN = '#7ED321'
const BG_CARD = '#141414'
const BORDER_STRONG = 'rgba(255,255,255,0.10)'
const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

export interface MatchesFilterBarProps {
  filters: MatchesFilters
  activeCount: number
  onOpen: () => void
  /** Optional left-aligned slot. When provided, the bar splits with
   *  space-between so the slot sits on the left and FILTROS on the right.
   *  Used for the "Today" shortcut on /matches/[date]. */
  leftSlot?: ReactNode
}

export default function MatchesFilterBar({
  filters,
  activeCount,
  onOpen,
  leftSlot,
}: MatchesFilterBarProps) {
  const tButton = useTranslations('matches.filters')
  const hasActive = activeCount > 0

  // Filter summary line removed per user feedback — the badge count on
  // the Filters button alone communicates whether anything is active,
  // and the line was eating space without adding info beyond defaults.
  // buildSummary + the summary translator were dropped in the same pass.
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: leftSlot ? 'space-between' : 'flex-end',
        padding: '4px 16px 10px',
        gap: 8,
      }}
    >
      {leftSlot}
      <button
        type="button"
        onClick={onOpen}
        aria-label={tButton('open')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          background: BG_CARD,
          border: `1px solid ${BORDER_STRONG}`,
          color: '#fff',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          clipPath: CHUNKY_BUTTON,
          cursor: 'pointer',
          flexShrink: 0,
          fontFamily: 'inherit',
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        {tButton('open')}
        {hasActive && (
          <span
            style={{
              background: GREEN,
              color: '#0A0A0A',
              fontSize: 9,
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 8,
              minWidth: 16,
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            {activeCount}
          </span>
        )}
      </button>
    </div>
  )
}
