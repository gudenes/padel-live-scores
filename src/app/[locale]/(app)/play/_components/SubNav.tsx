'use client'
import { useTranslations } from 'next-intl'
import LiveNudge from './LiveNudge'
import styles from './MatchNavigation.module.css'
export type SubNavKey = 'markets' | 'activity' | 'leaders' | 'mine'
export default function SubNav({ active, onSelect, liveCount = 0, myLiveCount = 0 }: { myLiveCount?: number; liveCount?: number; active: SubNavKey; onSelect: (key: SubNavKey) => void }) {
  const t = useTranslations('play')
  return <nav className="pl-subnav pl-main-tabs" aria-label={t('subnav.label')}>
    {(['markets', 'mine', 'leaders'] as const).map(key => <button type="button" key={key}
      className={active === key || (key === 'mine' && active === 'activity') ? 'pl-on' : undefined}
      aria-current={active === key || (key === 'mine' && active === 'activity') ? 'page' : undefined}
      onClick={() => onSelect(key)}>{t(`subnav.${key}`)}{key === 'markets' && <LiveNudge count={liveCount} />}{key === 'mine' && myLiveCount > 0 && <span className={styles.count}>{t('matchNavigation.liveCount',{count:myLiveCount})}</span>}</button>)}
  </nav>
}
