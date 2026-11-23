 'use client'
import {useEffect,useState} from 'react'
import {useTranslations} from 'next-intl'
import GlobalHeader from '@/components/nav/GlobalHeader'
import {Press} from './shared'
import styles from './PlayerLoading.module.css'

export default function PlayerLoading({error=false,onRetry}:{error?:boolean;onRetry?:()=>void}){
 const t=useTranslations('play')
 const [slow,setSlow]=useState(false)
 useEffect(()=>{const timer=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(timer)},[])
 return <div className={styles.screen}>
  <GlobalHeader playerWallet={<div className={styles.account} aria-hidden="true"><span/><i/></div>}/>
  <div className={styles.content}>
   <div className={styles.tabs} aria-hidden="true"><i/><i/><i/></div>
   <section className={styles.card} aria-busy={!error}>
    <div className={styles.portrait} aria-hidden="true"><svg viewBox="0 0 80 80" fill="currentColor"><circle cx="40" cy="28" r="13"/><path d="M15 73v-7a25 25 0 0 1 50 0v7z"/></svg></div>
    <p className={styles.eyebrow}>PADEL PREDICT</p>
    <h1 role={error?'alert':'status'}>{t(error?'onboarding.loadError':'onboarding.loading')}</h1>
    {!error&&<><p className={styles.hint}>{t(slow?'onboarding.loadingSlow':'onboarding.loadingHint')}</p><div className={styles.track} aria-hidden="true"><span/></div></>}
    {error&&<Press onClick={onRetry}>{t('error.retry')}</Press>}
   </section>
   {!error&&<div className={styles.placeholders} aria-hidden="true"><div/><div/><div/></div>}
  </div>
 </div>
}
