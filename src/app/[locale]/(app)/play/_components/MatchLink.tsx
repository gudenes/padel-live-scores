'use client'
import {Link} from '@/i18n/navigation'
import {useTranslations} from 'next-intl'
import styles from './MatchNavigation.module.css'
export default function MatchLink({matchId,live,iconOnly=false}:{matchId?:string|null;live:boolean;iconOnly?:boolean}){
 const t=useTranslations('play.matchNavigation')
 if(!matchId)return null
 return <Link className={iconOnly?styles.iconLink:styles.link} aria-label={t(live?'followLive':'viewMatch')} title={t(live?'followLive':'viewMatch')} data-live={live} href={`/match/${matchId}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>{live&&<span className={styles.dot} aria-hidden/>}{!iconOnly&&t(live?'followLive':'viewMatch')} <span aria-hidden>↗</span></Link>
}
