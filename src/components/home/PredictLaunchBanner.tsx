'use client'

import Image from 'next/image'
import {useState} from 'react'
import {useTranslations} from 'next-intl'
import {Link} from '@/i18n/navigation'
import {PREDICT_LAUNCH_ENABLED} from '@/lib/predict-launch'
import styles from './PredictLaunchBanner.module.css'

export default function PredictLaunchBanner(){
 const t=useTranslations('predictLaunch')
 const [dismissed,setDismissed]=useState(false)
 if(!PREDICT_LAUNCH_ENABLED||dismissed)return null
 return <section className={styles.banner} aria-label={t('label')}>
  <div className={styles.art}>
   <Image src="/play/launch/friends-weekly-prize.png" alt={t('imageAlt')} width={1536} height={1024} sizes="(max-width: 500px) 100vw, 468px" priority/>
   <span className={styles.label}>PADEL PREDICT</span>
   <button className={`${styles.close} pn-press shape-chunky-tilted intent-neutral size-sm icon-only`} aria-label={t('dismiss')} onClick={()=>setDismissed(true)}><span className="pn-press-skirt"/><span className="pn-press-face" aria-hidden="true">×</span></button>
  </div>
  <div className={styles.content}>
   <p className={styles.eyebrow}>{t('eyebrow')}</p>
   <h2>{t('title')}</h2>
   <p className={styles.body}>{t('body')}</p>
   <p className={styles.prize}>{t('prize')}</p>
   <p className={styles.disclaimer}><strong>{t('free')}</strong><span>{t('virtual')}</span></p>
   <Link href="/play" className={`${styles.cta} pn-press shape-chunky-tilted intent-primary size-lg`}><span className="pn-press-skirt"/><span className="pn-press-face">{t('cta')} <span aria-hidden="true">→</span></span></Link>
  </div>
 </section>
}
