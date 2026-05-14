'use client'

// src/components/MatchesFilterBar.tsx
//
// Sticky bar that lives between the day-pills row and the match list.
// Holds two affordances: a one-tap LIVE toggle (jumps to live-only and
// back) plus a Filters button that opens the full drawer. The summary
// line that used to sit on the left was removed because it read defaults
// back to the user without adding signal.

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { type MatchesFilters } from '@/hooks/useMatchesFilters'
import type { LiveChannel } from './YoutubeLiveIndicator'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const BORDER_STRONG = 'rgba(255,255,255,0.10)'
const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

export interface MatchesFilterBarProps {
  filters: MatchesFilters
  activeCount: number
  onOpen: () => void
  /** Toggle live-only mode. Implementation lives in the parent so the
   *  drawer state stays in sync — the toggle just nudges the existing
   *  status filter checkboxes. */
  onToggleLive: () => void
  /** Whether the active day actually has any live match. When false the
   *  pulse animation is suppressed so the pill doesn't claim activity
   *  that isn't there. */
  hasLiveMatches: boolean
  /** Optional left-aligned slot. When provided, the bar splits with
   *  space-between so the slot sits on the left and FILTROS on the right.
   *  Used for the "Today" shortcut on /matches/[date]. */
  leftSlot?: ReactNode
  /** Optional ref forwarded to the LIVE pill button. Lets the parent
   *  anchor a popup (the "no live matches" hint) to the pill's exact
   *  screen position. */
  liveButtonRef?: React.Ref<HTMLButtonElement>
  /** YouTube live broadcasts to surface in the page-level indicator.
   *  Empty array → indicator hidden. Server-rendered; refreshes per nav. */
  liveChannels?: LiveChannel[]
}

export default function MatchesFilterBar({
  filters,
  activeCount,
  onOpen,
  onToggleLive,
  hasLiveMatches,
  leftSlot,
  liveButtonRef,
  liveChannels: _liveChannels = [],
}: MatchesFilterBarProps) {
  const tButton = useTranslations('matches.filters')
  const hasActive = activeCount > 0
  const liveActive =
    filters.status.live && !filters.status.upcoming && !filters.status.finished

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
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <button
        ref={liveButtonRef}
        type="button"
        onClick={onToggleLive}
        aria-pressed={liveActive}
        aria-label={tButton('liveOnly')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          background: liveActive ? LIVE_RED : BG_CARD,
          border: `1px solid ${liveActive ? LIVE_RED : BORDER_STRONG}`,
          color: liveActive ? '#fff' : '#fff',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          clipPath: CHUNKY_BUTTON,
          cursor: 'pointer',
          flexShrink: 0,
          fontFamily: 'inherit',
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: liveActive ? '#fff' : LIVE_RED,
            boxShadow: liveActive ? '0 0 0 2px rgba(255,255,255,0.25)' : `0 0 0 2px rgba(255,70,85,0.25)`,
            // Pulse only when there's actually something live today —
            // a static dot when nothing's running, so the pill doesn't
            // visually promise activity that isn't there.
            animation: hasLiveMatches ? 'live-pulse 1.4s ease-in-out infinite' : 'none',
          }}
        />
        {tButton('liveOnly')}
      </button>
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
      <style jsx>{`
        @keyframes live-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </div>
  )
}
