'use client'
// src/app/[locale]/player/[id]/amateur/SeasonTab.tsx
// One row per game the player was fielded in. No opponent and no set score —
// the SNP source doesn't carry either.

import { useTranslations } from 'next-intl'
import type { AmateurProfileData } from '@/lib/amateur-profile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'

export function AmateurSeasonTab({ data }: { data: AmateurProfileData }) {
  const t = useTranslations('amateur')

  return (
    <div style={{ padding: '10px 14px 20px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 8, color: MUTED,
        textTransform: 'uppercase', letterSpacing: 0.8, padding: '8px 0 6px',
        borderBottom: '1px solid #1C1C1C',
      }}>
        <span style={{ flex: 1 }}>{t('roundColumn')}</span>
        <span style={{ width: 74 }}>{t('courtColumn')}</span>
        <span style={{ width: 66 }}>{t('resultColumn')}</span>
        <span style={{ width: 42, textAlign: 'right' }}>{t('setsColumn')}</span>
      </div>

      {data.games.map((g, i) => (
        <div
          key={`${g.fixtureCode}-${i}`}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 11, padding: '8px 0 8px 7px', borderBottom: '1px solid #171717',
            borderLeft: `2px solid ${g.result === 'W' ? GREEN : RED}`,
            opacity: g.complete ? 1 : 0.65,
          }}
        >
          <span style={{ flex: 1, fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{g.fixtureCode}</span>
          <span style={{ width: 74, fontSize: 9, color: g.worth === 3 ? ORANGE : MUTED }}>
            {t('usualCourtValue', { block: g.worth === 3 ? '1–2' : '3–5' })}
          </span>
          <span style={{ width: 66, fontSize: 10, color: g.result === 'W' ? GREEN : RED }}>
            {g.result === 'W' ? t('won') : t('lost')}
          </span>
          <span style={{ width: 42, textAlign: 'right', fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
            {g.sets != null ? t('setsValue', { count: g.sets }) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
