// src/components/road-to-olympics/CriteriaScorecard.tsx

import React from 'react'
import { useTranslations } from 'next-intl'
import type { CriteriaStatus } from '@/types/road-to-olympics'
import { GREEN, ORANGE, BG_CARD, BORDER, MUTED, CHUNKY, SectionTitle } from '@/components/home/shared'

interface Row {
  key: string
  label: React.ReactNode
  pillStatus: CriteriaStatus
  pillText: string
}

interface Props {
  rows: Row[]
}

const PILL_STYLE: Record<CriteriaStatus, { bg: string; color: string }> = {
  done:        { bg: 'rgba(126,211,33,0.18)', color: GREEN },
  'on-track':  { bg: 'rgba(126,211,33,0.12)', color: GREEN },
  building:    { bg: 'rgba(245,166,35,0.18)', color: ORANGE },
}

export default function CriteriaScorecard({ rows }: Props) {
  const t = useTranslations('roadToOlympics.scorecard')
  return (
    <section style={{
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      clipPath: CHUNKY.card,
      padding: 14,
      marginBottom: 12,
    }}>
      <SectionTitle>{t('title')}</SectionTitle>
      {rows.map((row, i) => {
        const pill = PILL_STYLE[row.pillStatus]
        return (
          <div key={row.key} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
            borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
            fontSize: 13,
          }}>
            <span style={{ color: '#e0e0e0' }}>{row.label}</span>
            <span style={{
              fontSize: 10,
              padding: '3px 7px',
              clipPath: CHUNKY.badge,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
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
