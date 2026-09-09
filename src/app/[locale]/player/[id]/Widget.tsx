'use client'

// Shared widget building blocks used by multiple player-profile tab components.

import { useRef } from 'react'
import { useInViewOnce } from '@/hooks/useInViewOnce'

const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const CHUNKY = {
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  iconChip: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
}

export function Widget({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      background: BG_CARD, padding: 12,
      clipPath: CHUNKY.card,
      position: 'relative',
      minHeight: 92,
      gridColumn: wide ? '1 / -1' : undefined,
    }}>
      <div style={{
        fontSize: 9, color: ORANGE, textTransform: 'uppercase',
        letterSpacing: 1, fontWeight: 700, marginBottom: 8,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

export function WidgetIcon({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', top: 10, right: 10,
      width: 22, height: 22,
      background: 'rgba(245,166,35,0.1)', color: ORANGE,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700,
      clipPath: CHUNKY.iconChip,
    }}>
      {children}
    </div>
  )
}

// Last 10 sparkline single bar (vertical, grows from bottom).
// Extracted into its own component so each iteration can have its own
// IntersectionObserver via useInViewOnce.
export function Last10SparkBar({
  won,
  isLatest,
  rowIndex,
  onClick,
  title,
  green,
  red,
  orange,
}: {
  won: boolean
  isLatest: boolean
  rowIndex: number
  onClick: (e: React.MouseEvent) => void
  title: string
  green: string
  red: string
  orange: string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(barRef)
  return (
    <div
      ref={barRef}
      onClick={onClick}
      title={title}
      style={{
        flex: 1,
        position: 'relative',
        height: won ? '100%' : '50%',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: won
            ? `linear-gradient(to top, ${green}, rgba(126,211,33,0.4))`
            : `linear-gradient(to top, ${red}, rgba(255,70,85,0.3))`,
          clipPath: 'polygon(0% 12%, 100% 0%, 100% 100%, 0% 100%)',
          outline: isLatest ? `1.5px solid ${orange}` : 'none',
          outlineOffset: isLatest ? 1 : 0,
          transformOrigin: 'bottom center',
          transform: inView ? 'scaleY(1)' : 'scaleY(0)',
          transition: `transform 700ms cubic-bezier(0.25, 0.1, 0.25, 1) ${rowIndex * 80}ms`,
        }}
      />
      {isLatest && (
        <div
          style={{
            position: 'absolute',
            top: -7,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 7,
            fontWeight: 800,
            color: orange,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
          }}
        >
          ▼
        </div>
      )}
    </div>
  )
}
