'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BADGE_CATALOG, LEGACY_BADGES, type TierNumber } from '@/lib/badges'
import { BadgeIcon } from './BadgeIcon'
import { BadgeTooltip } from './BadgeTooltip'
import type { EarnedBadge } from '@/hooks/useBadges'
import styles from './Badges.module.css'

export function BadgeGrid({earned,categoryFilter}: {earned:EarnedBadge[]; categoryFilter:string|null}) {
  const t = useTranslations('badgeCollection')
  const [selected,setSelected] = useState<string|null>(null)
  const earnedMap = new Map<string,number>()
  earned.forEach(b=>earnedMap.set(b.badge_id,Math.max(earnedMap.get(b.badge_id)??0,b.tier)))
  const legacy = categoryFilter === 'legacy'
  const catalog = legacy ? LEGACY_BADGES.filter(b=>earnedMap.has(b.id)) : BADGE_CATALOG.filter(b=>!categoryFilter || b.category===categoryFilter)
  const badge = catalog.find(b=>b.id===selected)
  return <>
    {legacy && <p className={styles.note}>{t('legacyNote')}</p>}
    <div className={styles.grid}>
      {catalog.map(b=>{
        const tier = (earnedMap.get(b.id)??null) as TierNumber|null
        return <button type="button" key={b.id} className={styles.tile} onClick={()=>setSelected(b.id)}>
          <BadgeIcon svgIcon={b.svgIcon} tier={tier} size={108}/>
          <strong>{t.has(`items.${b.id}.name`) ? t(`items.${b.id}.name`) : b.name}</strong>
          <span className={tier ? styles.earned : styles.muted}>{tier ? t('earned') : t('locked')}{tier && b.tiers.length>1 ? ` · ${t('tier',{tier})}` : ''}</span>
        </button>
      })}
    </div>
    {badge && <BadgeTooltip badge={badge} earnedTier={earnedMap.get(badge.id)??null} onClose={()=>setSelected(null)}/>}
  </>
}
