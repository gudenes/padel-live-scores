'use client'

// Shared widget building blocks used by multiple player-profile tab components.

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
