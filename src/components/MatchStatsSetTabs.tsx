'use client'
// src/components/MatchStatsSetTabs.tsx
//
// Horizontal pill row used at the top of the Stats tab. Lets the user
// switch between the aggregate match stats and individual set stats.
// Disabled pills (for sets not played) render greyed out.

import type { CSSProperties } from 'react'

const GREEN = '#7ed321'
const MUTED = '#8a8f98'
const BORDER = 'rgba(255, 255, 255, 0.08)'

export interface SetTabItem {
  setNumber: number       // 0 = Match aggregate, 1..5 = individual sets
  label: string           // 'Match' | 'Set 1' | 'Set 2' | ...
  disabled: boolean       // true when there's no data for this set
}

export interface MatchStatsSetTabsProps {
  tabs: SetTabItem[]
  active: number
  onChange: (setNumber: number) => void
}

const containerStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '8px 16px',
  borderBottom: `0.5px solid ${BORDER}`,
  background: 'rgba(0, 0, 0, 0.2)',
  overflowX: 'auto',
}

const pillBase: CSSProperties = {
  fontSize: 10,
  padding: '4px 12px',
  border: `0.5px solid ${BORDER}`,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  borderRadius: 4,
}

export function MatchStatsSetTabs({ tabs, active, onChange }: MatchStatsSetTabsProps) {
  return (
    <div style={containerStyle}>
      {tabs.map(tab => {
        const isActive = tab.setNumber === active
        const style: CSSProperties = {
          ...pillBase,
          fontWeight: isActive ? 700 : 500,
          background: isActive
            ? 'rgba(126, 211, 33, 0.12)'
            : tab.disabled
              ? 'rgba(255, 255, 255, 0.02)'
              : 'rgba(255, 255, 255, 0.04)',
          borderColor: isActive ? 'rgba(126, 211, 33, 0.3)' : BORDER,
          color: isActive
            ? GREEN
            : tab.disabled
              ? 'rgba(138, 143, 152, 0.4)'
              : MUTED,
          cursor: tab.disabled ? 'not-allowed' : 'pointer',
        }
        return (
          <button
            key={tab.setNumber}
            type="button"
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.setNumber)}
            style={style}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
