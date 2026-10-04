'use client'
import Image from 'next/image'
import {useLocale,useTranslations} from 'next-intl'
import {Link} from '@/i18n/navigation'
import LoginSheet from '@/components/LoginSheet'
import {Face} from './PlayOnboarding'
import styles from './PlayOnboarding.module.css'
export default function PlayWelcome(){
 const t=useTranslations('play.onboarding'),locale=useLocale(),detail=useTranslations('play.detail')
 return <main data-play-onboarding-screen className={styles.intro}>
 <header className={styles.loginHeader}><Image src="/padelnachos-logo-v2.png" alt="Padel Nachos" width={100} height={54} style={{objectFit:"contain"}}/><Link href="/matches" replace aria-label={detail('close')} className={`${styles.loginClose} pn-press shape-chunky-tilted intent-neutral size-sm`}><span className="pn-press-skirt" aria-hidden="true"/><span className="pn-press-face"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></span></Link></header>
 <div className={styles.loginHero}><Image src="/play/onboarding/friendly-duo-v2.webp" alt="" width={960} height={1440} priority sizes="(max-width: 600px) 100vw, 460px"/></div>
 <h1>{t('welcomeTitle')}</h1><p>{t('welcomeBody')}</p>
 <div className={styles.communityPanel}><div className={styles.communityFaces}>{(['face-06','face-03','face-07','face-02'] as const).map(avatar=><span key={avatar}><Face avatar={avatar}/></span>)}</div><div><strong>{t('community')}</strong></div></div>
 <div className={styles.loginActions}><LoginSheet embedded open callbackUrl={`/${locale}/play`} onClose={()=>{}}/></div>
 <small className={styles.nextStep}>{t('communityBody')}</small>
 </main>
}
