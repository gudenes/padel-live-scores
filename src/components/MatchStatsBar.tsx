'use client'
// src/components/MatchStatsBar.tsx
//
// Single stat row for the Match Stats tab. Design:
//
//   62% ───────── Label ───────── 69%
//   [====green====][====blue====]     <- split bar, flex-based, CHUNKY clipped
//
// Team 1 (green) takes the left portion of the bar proportional to its
// value; team 2 (blue) takes the right portion. The split point is at
// team1_value / (team1_value + team2_value). For percentages, this
// naturally aligns near the middle when both teams are close. For count
// stats (games played, streak), the bar still splits proportionally.

import type { CSSProperties } from 'react'

const PAIR1_COLOR = '#7ed321'
const PAIR2_COLOR = '#4a90e2'
const MUTED = '#8a8f98'
const BORDER = 'rgba(255, 255, 255, 0.08)'
const TRACK_BG = 'rgba(255, 255, 255, 0.04)'

// Chunky bar shape from the app's brand system (home/page.tsx)
const CHUNKY_BAR = 'polygon(2% 0%, 98% 4%, 100% 100%, 0% 96%)'

export interface MatchStatsBarProps {
  label: string
  kind: 'percentage' | 'count'
  t1Value: number | null
  t1Total: number | null
  t2Value: number | null
  t2Total: number | null
}

function pct(value: number | null, total: number | null): number | null {
  if (value == null || total == null || total === 0) return null
  return Math.round((value / total) * 100)
}

function formatDisplay(
  kind: 'percentage' | 'count',
  value: number | null,
  total: number | null,
): string {
  if (kind === 'count') return value == null ? '—' : String(value)
  const p = pct(value, total)
  return p == null ? '—' : `${p}%`
}

// Derive the numeric weight used for the flex-based bar split.
// For percentages, weight = pct (0..100). For counts, weight = raw value.
function weightOf(kind: 'percentage' | 'count', value: number | null, total: number | null): number {
  if (kind === 'percentage') return pct(value, total) ?? 0
  return value ?? 0
}

// ── Styles ───────────────────────────────────────────────────

const rowContainer: CSSProperties = {
  padding: '14px 16px 16px',
  borderBottom: `0.5px solid ${BORDER}`,
}

const labelRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 10,
}

const t1NumStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: PAIR1_COLOR,
  fontFamily: 'monospace',
  minWidth: 44,
  textAlign: 'left',
  flexShrink: 0,
}

const t2NumStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: PAIR2_COLOR,
  fontFamily: 'monospace',
  minWidth: 44,
  textAlign: 'right',
  flexShrink: 0,
}

const labelCenter: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const dashStyle: CSSProperties = {
  flex: 1,
  height: 1,
  background: BORDER,
}

const labelTextStyle: CSSProperties = {
  fontSize: 10,
  color: MUTED,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const trackOuter: CSSProperties = {
  position: 'relative',
  height: 8,
  background: TRACK_BG,
  clipPath: CHUNKY_BAR,
  overflow: 'hidden',
}

const trackInner: CSSProperties = {
  display: 'flex',
  height: '100%',
  width: '100%',
}

// ── Component ────────────────────────────────────────────────

export function MatchStatsBar({
  label,
  kind,
  t1Value,
  t1Total,
  t2Value,
  t2Total,
}: MatchStatsBarProps) {
  const t1Display = formatDisplay(kind, t1Value, t1Total)
  const t2Display = formatDisplay(kind, t2Value, t2Total)

  const t1Weight = weightOf(kind, t1Value, t1Total)
  const t2Weight = weightOf(kind, t2Value, t2Total)
  // Guard against both-zero: in that case, render a blank track (flex 0 on both
  // sides leaves the background TRACK_BG visible).
  const bothZero = t1Weight === 0 && t2Weight === 0

  return (
    <div style={rowContainer}>
      {/* Value + label row */}
      <div style={labelRow}>
        <span style={t1NumStyle}>{t1Display}</span>
        <div style={labelCenter}>
          <div style={dashStyle} />
          <span style={labelTextStyle}>{label}</span>
          <div style={dashStyle} />
        </div>
        <span style={t2NumStyle}>{t2Display}</span>
      </div>

      {/* Split bar track */}
      <div style={trackOuter}>
        {!bothZero && (
          <div style={trackInner}>
            <div style={{ flex: t1Weight, background: PAIR1_COLOR, opacity: 0.85 }} />
            <div style={{ flex: t2Weight, background: PAIR2_COLOR, opacity: 0.85 }} />
          </div>
        )}
      </div>
    </div>
  )
}
