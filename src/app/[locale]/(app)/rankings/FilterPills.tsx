'use client'
// src/app/[locale]/(app)/rankings/FilterPills.tsx
// Two-row pill toggle (gender, rank type). Stateless: parent owns state.
// Swipe handlers are owned by RankingsInteractive (parent), not here.

import { useTranslations } from 'next-intl'
import {
  CHUNKY, GREEN, MEN_BLUE, WOMEN_PURPLE,
  type RankType, type Gender,
} from './shared'

type Props = {
  rankType: RankType
  gender: Gender
  onChange: (next: { rankType: RankType; gender: Gender }) => void
}

export function FilterPills({ rankType, gender, onChange }: Props) {
  const t = useTranslations('rankings')

  const pillStyle = (active: boolean, color: string): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: active ? '#000' : color,
    background: active ? color : 'transparent',
    border: `1.5px solid ${color}`,
    clipPath: CHUNKY.button,
    cursor: 'pointer',
  })

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={pillStyle(gender === 'men', MEN_BLUE)}
          onClick={() => onChange({ rankType, gender: 'men' })}
          aria-pressed={gender === 'men'}
        >
          {t('men')}
        </button>
        <button
          type="button"
          style={pillStyle(gender === 'women', WOMEN_PURPLE)}
          onClick={() => onChange({ rankType, gender: 'women' })}
          aria-pressed={gender === 'women'}
        >
          {t('women')}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={pillStyle(rankType === 'official', GREEN)}
          onClick={() => onChange({ rankType: 'official', gender })}
          aria-pressed={rankType === 'official'}
        >
          {t('official')}
        </button>
        <button
          type="button"
          style={pillStyle(rankType === 'race', GREEN)}
          onClick={() => onChange({ rankType: 'race', gender })}
          aria-pressed={rankType === 'race'}
        >
          {t('race')}
        </button>
      </div>
    </div>
  )
}
