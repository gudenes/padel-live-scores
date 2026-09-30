'use client'

import { useLocale, useTranslations } from 'next-intl'
import { formatGuacas } from './shared'
import type { PlayPosition } from './types'

export default function PositionNudge({ positions, onOpen }: { positions: PlayPosition[]; onOpen?: () => void }) {
  const t = useTranslations('play')
  const locale = useLocale()
  const held = positions.filter(position => position.shares > 0)
  if (!held.length) return null
  const Tag = onOpen ? 'button' : 'div'
  return <Tag type={onOpen ? 'button' : undefined} className="pl-position-nudge" onClick={onOpen}>
    <span className="pl-position-label">{t('positions.yourPosition')}</span>
    <span className="pl-position-amounts">{(['yes', 'no'] as const).map(side => {
      const rows = held.filter(position => position.side === side)
      if (!rows.length) return null
      return <strong key={side} className={`pl-position-${side}`}>{t(`deck.${side}`)} · {t('positions.investedAmount', { amount: formatGuacas(rows.reduce((sum, position) => sum + position.costBasis, 0), locale) })}</strong>
    })}</span>
    {onOpen && <span aria-hidden="true">↗</span>}
  </Tag>
}
