// src/components/road-to-olympics/CountdownCard.tsx
//
// Big-number countdown to the next IOC milestone. Receives daysUntil from
// the page (computed server-side). When countdownLabel is set on state.json
// (override e.g. "Decision postponed"), the override label replaces the unit.

import { GREEN, CHUNKY } from '@/components/home/shared'

interface Props {
  daysUntil: number
  label: string                  // e.g. "Until IOC Session · Brisbane 2032 decision"
  unit: string                   // "days" / "Today" override
  override?: string | null       // when state.json sets countdownLabel
}

export default function CountdownCard({ daysUntil, label, unit, override }: Props) {
  const display = override ? override : daysUntil === 0 ? unit : `${daysUntil} ${unit}`
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(126,211,33,0.18), rgba(126,211,33,0.04))',
      border: '1px solid rgba(126,211,33,0.4)',
      clipPath: CHUNKY.card,
      padding: 16,
      marginBottom: 14,
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 32,
        fontWeight: 800,
        color: GREEN,
        letterSpacing: -1,
        lineHeight: 1,
      }}>
        {display}
      </div>
      <div style={{
        fontSize: 10,
        color: '#b8b8b8',
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginTop: 6,
      }}>
        {label}
      </div>
    </div>
  )
}
