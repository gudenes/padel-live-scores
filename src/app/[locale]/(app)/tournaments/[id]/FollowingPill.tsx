'use client'

import { useTranslations } from 'next-intl'
import type { RoundCode } from './bracket-builder'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'

const ROUND_TRANSLATION: Record<RoundCode, string> = {
  R64: 'R64', R32: 'R32', R16: 'R16', QF: 'QF', SF: 'SF', F: 'F',
}

type Props = {
  pairLabel: string                          // e.g. "Coello/Tapia"
  variant: 'tracking' | 'defendingChamp'
  eliminatedAt: RoundCode | null             // null = still active or champion
  onDismiss: () => void
}

export default function FollowingPill({ pairLabel, variant, eliminatedAt, onDismiss }: Props) {
  const t = useTranslations('draw')
  const accent = variant === 'defendingChamp' ? ORANGE : GREEN
  const lblText = variant === 'defendingChamp' ? t('defendingChamp') : t('following')
  const bg = variant === 'defendingChamp'
    ? 'rgba(245,166,35,0.08)'
    : 'rgba(126,211,33,0.08)'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', background: bg,
      borderLeft: `3px solid ${accent}`, marginBottom: 10, fontSize: 11,
    }}>
      <span style={{
        color: variant === 'defendingChamp' ? ORANGE : MUTED,
        fontWeight: 600, letterSpacing: '0.04em',
        textTransform: 'uppercase', fontSize: 9,
      }}>
        {lblText}
      </span>
      <span style={{ color: '#fff', fontWeight: 600, flex: 1 }}>
        {pairLabel}
        {eliminatedAt && (
          <span style={{ color: MUTED, fontWeight: 400, marginLeft: 6 }}>
            · {t('outInRound', { round: ROUND_TRANSLATION[eliminatedAt] })}
          </span>
        )}
      </span>
      <button
        onClick={onDismiss}
        aria-label="Clear"
        style={{
          color: MUTED, fontSize: 14, background: 'none',
          border: 'none', cursor: 'pointer', padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  )
}
