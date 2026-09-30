"use client"
import { useRef, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BadgeIcon } from './BadgeIcon'
import { BADGE_CATALOG, TIER_META, type BadgeDefinition, type TierNumber } from '@/lib/badges'
import styles from './Badges.module.css'

/**
 * Compute a human-readable description + next-tier hint for a badge.
 * Same logic used inside BadgeGrid.tsx so both surfaces show identical copy.
 */
export function getBadgeProgressText(badge: BadgeDefinition, currentTier: number | null): string {
  if (badge.isSingleTier) {
    if (currentTier) {
      return badge.isPremium
        ? `${badge.description}\n\n✨ You're one of the originals.`
        : `${badge.description}\n\n✅ Earned!`
    }
    return badge.description
  }
  if (!currentTier) {
    const first = badge.tiers[0]
    if (first) return `${badge.description}\n\nReach ${first.threshold} to unlock.`
    return badge.description
  }
  const nextTier = badge.tiers.find(t => t.tier > currentTier)
  if (!nextTier) {
    return `${badge.description}\n\nMax tier reached! 🎉`
  }
  const nextMeta = TIER_META[nextTier.tier as TierNumber]
  return `${badge.description}\n\nNext: ${nextMeta.label} at ${nextTier.threshold}.`
}


export function BadgeTooltip({badge,earnedTier,onClose}: {badge:BadgeDefinition;earnedTier:number|null;onClose:()=>void}) {
  const t = useTranslations('badgeCollection')
  const dialog = useRef<HTMLDialogElement>(null)
  const [progress,setProgress] = useState<number|null>(null)
  const [error,setError] = useState(false)
  const [attempt,setAttempt] = useState(0)
  const legacy = !BADGE_CATALOG.some(b=>b.id===badge.id)
  useEffect(()=>{
    const el=dialog.current
    el?.showModal()
    return ()=>el?.close()
  },[])
  useEffect(()=>{
    if(legacy) return
    const abort = new AbortController()
    fetch('/api/user/badges?progress=true',{signal:abort.signal,cache:'no-store'})
      .then(async r=>{if(!r.ok) throw new Error();return r.json()})
      .then(d=>{if(!abort.signal.aborted) setProgress(d.progress[badge.id]??0)})
      .catch(()=>{if(!abort.signal.aborted) setError(true)})
    return ()=>abort.abort()
  },[badge.id,legacy,attempt])
  const target = badge.isSingleTier ? 1 : (badge.tiers.find(tier=>tier.tier>(earnedTier??0))?.threshold ?? badge.tiers.at(-1)?.threshold ?? 1)
  const name = t.has(`items.${badge.id}.name`) ? t(`items.${badge.id}.name`) : badge.name
  const description = t.has(`items.${badge.id}.description`) ? t(`items.${badge.id}.description`) : badge.description
  const max = !!earnedTier && (badge.isSingleTier || earnedTier >= (badge.tiers.at(-1)?.tier??1))
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="badge-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)onClose()}}}>
    <button type="button" className={styles.close} aria-label={t('close')} onClick={onClose}>×</button>
    <div className={styles.art}><BadgeIcon svgIcon={badge.svgIcon} tier={earnedTier as TierNumber | null} size={148}/></div>
    <span className={earnedTier?styles.earned:styles.muted}>{t(earnedTier?'earned':'locked')}</span>
    <h2 id="badge-title">{name}</h2>
    <p>{description}</p>
    {legacy ? <p className={styles.muted}>{t('legacyNote')}</p> : <>
      {max ? <strong className={styles.earned}>{t(badge.tiers.length>1?'max':'earned')}</strong> : <strong>{t('target',{target})}</strong>}
      {progress!==null ? <>
        <div className={styles.progress} role="progressbar" aria-label={t('progress')} aria-valuenow={Math.min(progress,target)} aria-valuemin={0} aria-valuemax={target}><span style={{width:`${Math.min(100,progress/target*100)}%`}}/></div>
        <div className={styles.muted}>{t('progress')}: {progress} / {target}</div>
      </> : <p role="status" className={styles.muted}>{t(error?'error':'loading')}{error && <button className={styles.filter} onClick={()=>{setError(false);setAttempt(a=>a+1)}}>{t('retry')}</button>}</p>}
      {badge.tiers.length>1 && <div className={styles.milestones}>{badge.tiers.map(tier=><span key={tier.tier} className={(earnedTier??0)>=tier.tier?styles.complete:undefined}>{t('tier',{tier:tier.tier})}<br/>{tier.threshold}</span>)}</div>}
      {badge.category==='prediction' && <p className={styles.muted}>{t('predictionNote')}</p>}
    </>}
  </dialog>
}
