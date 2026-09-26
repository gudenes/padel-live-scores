'use client'
// src/app/[locale]/(app)/play/_components/SubNav.tsx
//
// Markets · Activity · Leaders · [balance chip].
//
// The balance chip doubles as the route into your positions: tapping your
// money to see your money is the obvious gesture, and it buys back a tab
// slot that would otherwise go to a fourth label.

import { useLocale, useTranslations } from 'next-intl'
import { formatGuacas } from './shared'

export type SubNavKey = 'markets' | 'activity' | 'leaders' | 'mine'

export interface SubNavProps {
  active: SubNavKey
  balance: number
  /** Unseen-activity dot. Only set when there is genuinely new activity. */
  activityDot: boolean
  onSelect: (key: SubNavKey) => void
}

export default function SubNav({ active, balance, activityDot, onSelect }: SubNavProps) {
  const t = useTranslations('play')
  const locale = useLocale()

  return (
    <nav className="pl-subnav" aria-label={t('subnav.label')}>
      <button
        type="button"
        className={active === 'markets' ? 'pl-on' : undefined}
        aria-current={active === 'markets' ? 'page' : undefined}
        onClick={() => onSelect('markets')}
      >
        {t('subnav.markets')}
      </button>
      <button
        type="button"
        className={active === 'activity' ? 'pl-on' : undefined}
        aria-current={active === 'activity' ? 'page' : undefined}
        onClick={() => onSelect('activity')}
      >
        {t('subnav.activity')}
        {activityDot && <span className="pl-badge" aria-hidden />}
      </button>
      <button
        type="button"
        className={active === 'leaders' ? 'pl-on' : undefined}
        aria-current={active === 'leaders' ? 'page' : undefined}
        onClick={() => onSelect('leaders')}
      >
        {t('subnav.leaders')}
      </button>
      <button
        type="button"
        className={`pl-balchip${active === 'mine' ? ' pl-on' : ''}`}
        aria-label={t('subnav.myPositions')}
        aria-current={active === 'mine' ? 'page' : undefined}
        onClick={() => onSelect('mine')}
      >
        <span className="pl-balchip-value"><span className="pl-coin">G</span><span>{formatGuacas(balance, locale)}</span></span>
        <span className="pl-balchip-label">{t('subnav.myPositions')}</span>
      </button>
    </nav>
  )
}
