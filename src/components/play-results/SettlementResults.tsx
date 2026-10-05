'use client'
import {useEffect,useState} from 'react'
import {useAuth} from '@/components/AuthProvider'
import {resultPanelData,type ResultNotification,type ResultPanelData} from '@/lib/play-result-panel'
import type {PlayMe} from '@/app/[locale]/(app)/play/_components/types'
import ResultPanel from './ResultPanel'
/** Catch up once on entry; later settlements can surface without replaying the unread backlog. */
export default function SettlementResults({me,enabled,onView}:{me:PlayMe|null;enabled:boolean;onView:(marketId:string)=>void}){
 const {user}=useAuth()
 const [notices,setNotices]=useState<{userId:string;items:ResultNotification[]}|null>(null)
 const [dismissed,setDismissed]=useState<{userId:string;ids:string[]}|null>(null)
 const [shown,setShown]=useState<ResultPanelData[]|null>(null)
 useEffect(()=>{
  if(!user?.id||!enabled)return
  const controller=new AbortController()
  const load=()=>{if(document.visibilityState==='hidden')return;void fetch('/api/play/results',{cache:'no-store',signal:controller.signal}).then(async r=>{if(r.ok)setNotices({userId:user.id,items:(await r.json()).items})}).catch(()=>{})}
  load();const timer=setInterval(load,30_000);window.addEventListener('focus',load)
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',load)}
 },[enabled,user?.id])
 useEffect(()=>{
  if(!enabled||!user?.id||notices?.userId!==user.id||shown||!me)return
  const result=notices.items.filter(n=>dismissed?.userId!==user.id||!dismissed.ids.includes(n.id)).map(n=>resultPanelData(n,me.positions)).filter((r):r is ResultPanelData=>r!==null)
  if(result.length)setShown(result)
 },[notices,enabled,user?.id,dismissed,shown,me])
 if(!enabled||!shown||!user?.id||notices?.userId!==user.id)return null
 const close=()=>{
  setDismissed({userId:user.id,ids:[...(dismissed?.userId===user.id?dismissed.ids:[]),...shown.map(r=>r.id)]});setShown(null)
  void fetch('/api/play/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:shown.map(r=>r.id)})}).then(r=>{if(r.ok)window.dispatchEvent(new Event('pn:notifications-updated'))}).catch(()=>{})
 }
 return <ResultPanel result={shown[0]} results={shown} onClose={close} onView={()=>{const id=shown.length>1?'all':shown[0].marketId;close();onView(id)}}/>
}
