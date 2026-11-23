'use client'

import Image from 'next/image'
import {useEffect,useRef,useState} from 'react'
import {Capacitor} from '@capacitor/core'
import {useConsent} from '@/hooks/useConsent'
import {useLoginSheet} from '@/components/LoginSheetProvider'
import {useTranslations} from 'next-intl'
import {Link} from '@/i18n/navigation'
import {PREDICT_LAUNCH_ENABLED} from '@/lib/predict-launch'
import styles from './PredictLaunchBanner.module.css'

export const PREDICT_LAUNCH_DISMISSED_KEY='pn_predict_launch_2026_11_dismissed'
let dismissedInMemory=false
function isDismissed(){
 if(dismissedInMemory)return true
 try{return localStorage.getItem(PREDICT_LAUNCH_DISMISSED_KEY)==='1'}catch{return false}
}

export default function PredictLaunchBanner(){
 const t=useTranslations('predictLaunch')
 const {hasDecided}=useConsent()
 const {isOpen:loginOpen}=useLoginSheet()
 const [open,setOpen]=useState(false)
 const dialog=useRef<HTMLDialogElement>(null)
 const eligible=PREDICT_LAUNCH_ENABLED&&!loginOpen&&(hasDecided||Capacitor.isNativePlatform())
 function dismiss(){
  dismissedInMemory=true
  try{localStorage.setItem(PREDICT_LAUNCH_DISMISSED_KEY,'1')}catch{/* Keep dismissed for this session if storage is blocked. */}
  setOpen(false)
 }
 useEffect(()=>{
  if(!eligible||isDismissed())return
  const timer=window.setInterval(()=>{
   if(isDismissed()){window.clearInterval(timer);return}
   if(document.visibilityState!=='visible')return
   const dialogs=document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')
   if(Array.from(dialogs).some(element=>!element.closest('[hidden], [aria-hidden="true"]')))return
   setOpen(true);window.clearInterval(timer)
  },1000)
  return()=>window.clearInterval(timer)
 },[eligible])
 useEffect(()=>{
  const element=dialog.current
  if(!open||!eligible||!element)return
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
  element.showModal()
  const overflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  return()=>{element.close();document.body.style.overflow=overflow;previous?.focus({preventScroll:true})}
 },[open,eligible])
 if(!eligible||!open)return null
 return <dialog ref={dialog} className={styles.dialog} aria-label={t('label')} onCancel={event=>{event.preventDefault();dismiss()}}>
 <section className={styles.banner}>
  <div className={styles.art}>
   <Image src="/play/launch/friends-weekly-prize.png" alt={t('imageAlt')} width={1536} height={1024} sizes="(max-width: 500px) 100vw, 468px" priority/>
   <span className={styles.label}>PADEL PREDICT</span>
   <button className={`${styles.close} pn-press shape-chunky-tilted intent-neutral size-sm icon-only`} aria-label={t('dismiss')} onClick={dismiss}><span className="pn-press-skirt"/><span className="pn-press-face" aria-hidden="true">×</span></button>
  </div>
  <div className={styles.content}>
   <p className={styles.eyebrow}>{t('eyebrow')}</p>
   <h2>{t('title')}</h2>
   <p className={styles.body}>{t('body')}</p>
   <p className={styles.prize}>{t('prize')}</p>
   <p className={styles.disclaimer}><strong>{t('free')}</strong><span>{t('virtual')}</span></p>
   <Link href="/play" onClick={dismiss} className={`${styles.cta} pn-press shape-chunky-tilted intent-primary size-lg`}><span className="pn-press-skirt"/><span className="pn-press-face">{t('cta')} <span aria-hidden="true">→</span></span></Link>
  </div>
 </section>
 </dialog>
}
