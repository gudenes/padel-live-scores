'use client'

// src/components/MatchesFilterBar.tsx
//
// Sticky bar that lives between the day-pills row and the match list.
// Shows a one-line summary of active filters on the left ("All · M+W ·
// Live + Upcoming") and the "Filters" button on the right with an
// active-count badge. Tap → opens MatchesFilterDrawer.

import { useTranslations } from 'next-intl'
import {
  type MatchesFilters,
  type CategoryFilter,
  type LeagueFilter,
} from '@/hooks/useMatchesFilters'

const GREEN = '#7ED321'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER_STRONG = 'rgba(255,255,255,0.10)'
const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

export interface MatchesFilterBarProps {
  filters: MatchesFilters
  activeCount: number
  onOpen: () => void
}

export default function MatchesFilterBar({
  filters,
  activeCount,
  onOpen,
}: MatchesFilterBarProps) {
  const t = useTranslations('matches.filters.summary')
  const tButton = useTranslations('matches.filters')
  const summary = buildSummary(filters, t)
  const hasActive = activeCount > 0

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 16px 10px',
      }}
    >
      <div
        style={{
          flex: 1,
          fontSize: 11,
          color: MUTED,
          lineHeight: 1.3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {summary.map((part, i) => (
          <span key={i}>
            {i > 0 && <span style={{ opacity: 0.5 }}> · </span>}
            <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{part}</span>
          </span>
        ))}
      </div>
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

// ── Summary builder ──────────────────────────────────────────────────────
//
// Builds the list of bullet-separated tokens shown next to the Filters
// button. Order is intentional: League → Category → Status. A token is
// emitted only when it carries information beyond the default ("All ·
// Both · Live+Upcoming+Finished" gets compressed). When nothing is
// active, we show a simple "All matches" string so the line never
// goes empty.

function buildSummary(
  f: MatchesFilters,
  t: ReturnType<typeof useTranslations<'matches.filters.summary'>>,
): string[] {
  const out: string[] = []

  // League
  out.push(leagueLabel(f.league, t))

  // Category
  if (f.category !== 'both') {
    out.push(categoryLabel(f.category, t))
  } else {
    out.push(t('menWomen'))
  }

  // Status — only render when narrowed (something turned off)
  const allStatusOn = f.status.live && f.status.upcoming && f.status.finished
  if (!allStatusOn) {
    const parts: string[] = []
    if (f.status.live) parts.push(t('live'))
    if (f.status.upcoming) parts.push(t('upcoming'))
    if (f.status.finished) parts.push(t('finished'))
    if (parts.length > 0) out.push(parts.join(' + '))
  }

  return out
}

function leagueLabel(
  l: LeagueFilter,
  t: ReturnType<typeof useTranslations<'matches.filters.summary'>>,
): string {
  switch (l) {
    case 'premier':
      return t('premier')
    case 'fip':
      return t('fipTour')
    default:
      return t('all')
  }
}

function categoryLabel(
  c: CategoryFilter,
  t: ReturnType<typeof useTranslations<'matches.filters.summary'>>,
): string {
  return c === 'men' ? t('men') : t('women')
}
