'use client'
// src/components/MatchStatsBar.tsx
//
// Single side-by-side stat row for the Match Stats tab. Two variants:
//   - percentage: shows pct + fraction, bar fills inward from each side
//   - count: just the number, no bar, no fraction

import type { CSSProperties } from 'react'

const PAIR1_COLOR = '#7ed321'
const PAIR2_COLOR = '#4a90e2'
const MUTED = '#8a8f98'
const BORDER = 'rgba(255, 255, 255, 0.08)'

export interface MatchStatsBarProps {
  label: string
  kind: 'percentage' | 'count'
  t1Value: number | null
  t1Total: number | null
  t2Value: number | null
  t2Total: number | null
}

// Compute percentage from numerator/denominator. Returns null when either
// is null or the denominator is 0 (can't divide).
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

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '60px 1fr 60px',
  alignItems: 'center',
  gap: 12,
  padding: '10px 16px',
  borderBottom: `0.5px solid ${BORDER}`,
}

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

  const t1Pct = kind === 'percentage' ? (pct(t1Value, t1Total) ?? 0) : 0
  const t2Pct = kind === 'percentage' ? (pct(t2Value, t2Total) ?? 0) : 0

  return (
    <div style={rowStyle}>
      {/* Team 1 — left */}
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: PAIR1_COLOR,
            fontFamily: 'monospace',
          }}
        >
          {t1Display}
        </div>
        {t1Frac && (
          <div style={{ fontSize: 9, color: MUTED, fontFamily: 'monospace' }}>
            {t1Frac}
          </div>
        )}
      </div>

      {/* Center — label + optional bar */}
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 10,
            color: MUTED,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: 4,
          }}
        >
          {label}
        </div>
        {kind === 'percentage' && (
          <div
            style={{
              display: 'flex',
              height: 4,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${t1Pct}%`,
                background: PAIR1_COLOR,
                opacity: 0.8,
              }}
            />
            <div style={{ flex: 1 }} />
            <div
              style={{
                width: `${t2Pct}%`,
                background: PAIR2_COLOR,
                opacity: 0.8,
              }}
            />
          </div>
        )}
      </div>

      {/* Team 2 — right */}
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: PAIR2_COLOR,
            fontFamily: 'monospace',
          }}
        >
          {t2Display}
        </div>
        {t2Frac && (
          <div style={{ fontSize: 9, color: MUTED, fontFamily: 'monospace' }}>
            {t2Frac}
          </div>
        )}
      </div>
    </div>
  )
}
