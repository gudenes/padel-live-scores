// src/components/road-to-olympics/CriteriaScorecard.tsx

import { useTranslations } from 'next-intl'
import type { CriteriaStatus } from '@/types/road-to-olympics'

interface Row {
  key: string
  label: string
  pillStatus: CriteriaStatus
  pillText: string
}

interface Props {
  rows: Row[]
}

const PILL_STYLE: Record<CriteriaStatus, { bg: string; color: string }> = {
  done:        { bg: 'rgba(126,211,33,0.18)', color: '#7ed321' },
  'on-track':  { bg: 'rgba(126,211,33,0.12)', color: '#7ed321' },
  building:    { bg: 'rgba(255,176,32,0.18)', color: '#ffb020' },
}

export default function CriteriaScorecard({ rows }: Props) {
  const t = useTranslations('roadToOlympics.scorecard')
  return (
    <section style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8,
      padding: 14,
      marginBottom: 12,
    }}>
      <h2 style={{
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        color: '#888',
        margin: '0 0 10px',
        fontWeight: 700,
      }}>
        {t('title')}
      </h2>
      {rows.map((row, i) => {
        const pill = PILL_STYLE[row.pillStatus]
        return (
          <div key={row.key} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
            borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
            fontSize: 13,
          }}>
            <span style={{ color: '#e0e0e0' }}>{row.label}</span>
            <span style={{
              fontSize: 10,
              padding: '3px 9px',
              borderRadius: 999,
              fontWeight: 700,
              letterSpacing: 0.5,
              background: pill.bg,
              color: pill.color,
            }}>
              {row.pillText}
            </span>
          </div>
        )
      })}
    </section>
  )
}
