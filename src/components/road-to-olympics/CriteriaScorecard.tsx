// src/components/road-to-olympics/CriteriaScorecard.tsx

import React from 'react'
import { useTranslations } from 'next-intl'
import type { CriteriaStatus } from '@/types/road-to-olympics'
import { GREEN, ORANGE, BG_CARD, BORDER, CHUNKY } from '@/components/home/shared-constants'
import { SectionTitle } from '@/components/home/shared'
import CriteriaPillButton from '@/components/road-to-olympics/CriteriaPillButton'
import BlockerBadge from '@/components/road-to-olympics/BlockerBadge'

interface Row {
  key: string
  label: React.ReactNode
  pillStatus: CriteriaStatus
  pillText: string
  pillExplanation: string
  isBlocker: boolean
  blockerBadge: string
  blockerExplanation: string
}

interface Props {
  rows: Row[]
}

const PILL_STYLE: Record<CriteriaStatus, { bg: string; color: string }> = {
  done:        { bg: 'rgba(126,211,33,0.18)', color: GREEN },
  'on-track':  { bg: 'rgba(126,211,33,0.12)', color: GREEN },
  building:    { bg: 'rgba(245,166,35,0.18)', color: ORANGE },
}

// Warm orange-red left-edge accent for the blocker row
const BLOCKER_ACCENT = '#FF6F4A'

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
            paddingLeft: row.isBlocker ? 8 : 0,
            borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
            fontSize: 13,
            // Subtle left-edge accent on the blocker row
            borderLeft: row.isBlocker ? `2px solid ${BLOCKER_ACCENT}` : '2px solid transparent',
            // Very slight warm tint on the blocker row background
            background: row.isBlocker ? 'rgba(245, 90, 70, 0.04)' : 'transparent',
            marginLeft: row.isBlocker ? -8 : 0,
            marginRight: row.isBlocker ? -8 : 0,
            paddingRight: row.isBlocker ? 8 : 0,
          }}>
            <span style={{ color: '#e0e0e0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              {row.label}
              {row.isBlocker && (
                <BlockerBadge
                  label={row.blockerBadge}
                  explanation={row.blockerExplanation}
                />
              )}
            </span>
            <CriteriaPillButton
              pillText={row.pillText}
              pillBg={pill.bg}
              pillColor={pill.color}
              explanation={row.pillExplanation}
            />
          </div>
        )
      })}
    </section>
  )
}
