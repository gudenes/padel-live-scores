'use client'
import {useEffect,useState} from 'react'
import {useLocale,useTranslations} from 'next-intl'
import {Link} from '@/i18n/navigation'
import {useAuth} from '@/components/AuthProvider'
/** Both endpoints enforce Play membership. No Play promotion is shown to other viewers. */
export default function MatchPlayNavigation({matchId}:{matchId:string}){
 const {user}=useAuth(),locale=useLocale(),t=useTranslations('play.matchNavigation')
 const key=`${user?.id}:${matchId}:${locale}`
 const [result,setResult]=useState<{key:string;owned:boolean;open:boolean}|null>(null)
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
    if(!controller.signal.aborted)setResult({key,owned:(me.positions??[]).some((p:{matchId?:string})=>p.matchId===matchId),open:(markets.markets??[]).length>0})
   }catch{if(!controller.signal.aborted)setResult(null)}finally{pending=false}
  }
  void refresh();const timer=setInterval(refresh,30000)
  document.addEventListener('visibilitychange',refresh)
  return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
 },[key,user?.id,matchId,locale])
 if(result?.key!==key||(!result.owned&&!result.open))return null
 return <div style={{margin:'12px 16px',padding:'14px',border:'1px solid #52683c',background:'#222a1b',color:'#d7e9bd'}}>
  <Link href={result.owned?'/play?view=mine':`/play?match=${matchId}`} style={{color:'inherit',display:'block',fontWeight:750,padding:'8px 0'}}>{t(result.owned?'viewPlays':'predict')} <span aria-hidden>↗</span></Link>
 </div>
}
