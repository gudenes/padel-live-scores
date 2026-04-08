'use client'
// src/components/MatchStatsBar.tsx
//
// Single stat row for the Match Stats tab. Design:
//
//   62%     ───── First serve points won ─────   69%
//   53/86                                         44/64
//   [====green====][====blue====]     <- chunky split bar
//
// Team 1 (green) takes the left portion of the bar proportional to its
// value; team 2 (blue) takes the right portion. The split point is at
// team1_value / (team1_value + team2_value).
//
// For percentage kind, the row shows the big pct on top and the raw
// won/played fraction underneath in a smaller muted font. For count
// kind, only the raw number is shown (no fraction below).

import type { CSSProperties } from 'react'

const PAIR1_COLOR = '#7ed321'
const PAIR2_COLOR = '#4a90e2'
const MUTED = '#8a8f98'
const BORDER = 'rgba(255, 255, 255, 0.08)'
const TRACK_BG = 'rgba(255, 255, 255, 0.04)'

// Chunky bar shape from the app's brand system (home/page.tsx CHUNKY.bar)
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

function formatFraction(value: number | null, total: number | null): string {
  if (value == null || total == null) return ''
  return `${value}/${total}`
}

// Derive the numeric weight used for the flex-based bar split.
function weightOf(
  kind: 'percentage' | 'count',
  value: number | null,
  total: number | null,
): number {
  if (kind === 'percentage') return pct(value, total) ?? 0
  return value ?? 0
}

// ── Styles ───────────────────────────────────────────────────

const rowContainer: CSSProperties = {
  padding: '12px 16px 14px',
  borderBottom: `0.5px solid ${BORDER}`,
}

// Grid: [t1 cell] [center label] [t2 cell]
// Row 1: big numbers + label with dashes
// Row 2: fractions (t1, empty, t2)
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(56px, auto) 1fr minmax(56px, auto)',
  columnGap: 10,
  alignItems: 'center',
  marginBottom: 10,
}

const t1NumStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: PAIR1_COLOR,
  fontFamily: 'monospace',
  textAlign: 'left',
  lineHeight: 1.1,
}

const t2NumStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: PAIR2_COLOR,
  fontFamily: 'monospace',
  textAlign: 'right',
  lineHeight: 1.1,
}

const fracLeftStyle: CSSProperties = {
  fontSize: 9,
  color: MUTED,
  fontFamily: 'monospace',
  textAlign: 'left',
  lineHeight: 1.1,
  marginTop: 2,
}

const fracRightStyle: CSSProperties = {
  ...fracLeftStyle,
  textAlign: 'right',
}

const labelCenter: CSSProperties = {
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
  const t1Frac = kind === 'percentage' ? formatFraction(t1Value, t1Total) : ''
  const t2Frac = kind === 'percentage' ? formatFraction(t2Value, t2Total) : ''

  const t1Weight = weightOf(kind, t1Value, t1Total)
  const t2Weight = weightOf(kind, t2Value, t2Total)
  const bothZero = t1Weight === 0 && t2Weight === 0

  return (
    <div style={rowContainer}>
      {/* Row 1: numbers + label with dashes */}
      <div style={gridStyle}>
        <div style={t1NumStyle}>{t1Display}</div>
        <div style={labelCenter}>
          <div style={dashStyle} />
          <span style={labelTextStyle}>{label}</span>
          <div style={dashStyle} />
        </div>
        <div style={t2NumStyle}>{t2Display}</div>
      </div>

      {/* Row 2: fractions (only for percentage kind) */}
      {kind === 'percentage' && (t1Frac || t2Frac) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(56px, auto) 1fr minmax(56px, auto)',
            columnGap: 10,
            marginTop: -6,
            marginBottom: 10,
          }}
        >
          <div style={fracLeftStyle}>{t1Frac || '\u00a0'}</div>
          <div />
          <div style={fracRightStyle}>{t2Frac || '\u00a0'}</div>
        </div>
      )}

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
