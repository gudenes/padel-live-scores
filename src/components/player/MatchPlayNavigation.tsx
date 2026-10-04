'use client'
import {useEffect,useState} from 'react'
import {useLocale,useTranslations} from 'next-intl'
import {Link} from '@/i18n/navigation'
import {useAuth} from '@/components/AuthProvider'
import GuacaCoin from '@/components/GuacaCoin'
import {parseMe, type PlayPosition} from '@/app/[locale]/(app)/play/_components/types'
import badges from '@/app/[locale]/(app)/play/_components/PositionsScreen.module.css'
import styles from './MatchPlayNavigation.module.css'
/** Both endpoints enforce Play membership. No Play promotion is shown to other viewers. */
export default function MatchPlayNavigation({matchId}:{matchId:string}){
 const {user}=useAuth(),locale=useLocale(),t=useTranslations('play')
 const key=`${user?.id}:${matchId}:${locale}`
 const [result,setResult]=useState<{key:string;positions:PlayPosition[];open:boolean}|null>(null)
 useEffect(()=>{
  if(!user)return
  const controller=new AbortController()
  let pending=false
  async function refresh(){
   if(pending||document.hidden)return
   pending=true
   try{
    const responses=await Promise.all([fetch(`/api/play/me?locale=${locale}`,{signal:controller.signal}),fetch(`/api/play/markets?locale=${locale}&matchId=${matchId}`,{signal:controller.signal})])
    if(responses.some(r=>!r.ok)){setResult(null);return}
    const [me,markets]=await Promise.all(responses.map(r=>r.json()))
    if(!controller.signal.aborted)setResult({key,positions:parseMe(me).positions.filter(p=>p.matchId===matchId && p.shares>0),open:(markets.markets??[]).length>0})
   }catch{if(!controller.signal.aborted)setResult(null)}finally{pending=false}
  }
  void refresh();const timer=setInterval(refresh,30000)
  document.addEventListener('visibilitychange',refresh)
  return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
 },[key,user?.id,matchId,locale])
 if(result?.key!==key||(!result.positions.length&&!result.open))return null
 if(!result.positions.length)return <div className={styles.available}><Link href={`/play?match=${matchId}`}>{t('matchNavigation.predict')}</Link></div>
 return <details className={styles.panel} open>
  <summary>{t('matchNavigation.yourPlays')} · {result.positions.length}</summary>
  <div className={styles.rows}>{result.positions.map(position=>{
   const result=position.result ?? 'pending'
   return <div className={styles.row} key={`${position.marketId}:${position.side}`}>
    <p>{position.question}</p>
    <span className={badges.badge} data-tone={position.side}><span>{t(`deck.${position.side}`)}</span></span>
    <span className={styles.amount}>{new Intl.NumberFormat(locale,{maximumFractionDigits:0}).format(position.costBasis)} <GuacaCoin size={17}/></span>
    <span className={styles.status} data-result={result}>{result === 'pending' ? t('positions.filters.open') : t(`results.${result}`)}</span>
   </div>
  })}</div>
 </details>
}
