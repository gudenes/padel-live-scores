'use client'
import {useEffect,useState} from 'react'
import {useTranslations} from 'next-intl'
import SpotlightGuide from '@/components/SpotlightGuide'
export default function ShopGuide({userId,ready,paused,preview=false}:{userId?:string;ready:boolean;paused:boolean;preview?:boolean}){
 const t=useTranslations('shopGuide')
 const [step,setStep]=useState<number|null>(null)
 const [owner,setOwner]=useState<string|null>(null)
 useEffect(()=>{
  if(!ready||(!userId&&!preview))return
  let active=true
  const identity=preview?'preview':userId!
  setOwner(identity);setStep(null)
  if(preview){setStep(0);return}
  // Local completion prevents repeats even if the network is temporarily unavailable.
  const key=`pn:shop-guide:v1:${identity}`
  let seen=false;try{seen=localStorage.getItem(key)==='done'}catch{}
  if(seen){void fetch('/api/play/shop-guide',{method:'POST'}).catch(()=>{});return}
  fetch('/api/play/shop-guide',{cache:'no-store',signal:AbortSignal.timeout(8000)}).then(async response=>{if(!response.ok)throw Error();return response.json()}).then(data=>{if(active&&!data.seen)setStep(0)}).catch(()=>{if(active)setStep(0)})
  return()=>{active=false}
 },[userId,ready,preview])
 function finish(){
  setStep(null)
  if(preview||!userId)return
  try{localStorage.setItem(`pn:shop-guide:v1:${userId}`,'done')}catch{}
  void fetch('/api/play/shop-guide',{method:'POST'}).catch(()=>{})
 }
 if(step===null||owner!==(preview?'preview':userId))return null
 const targets=['[data-shop-categories]','[data-shop-items]','[data-shop-action]']
 return <SpotlightGuide step={`shop-${step}`} active={!paused} selector={targets[step]} label={t('label')} eyebrow={`${t('label')} · ${step+1}/3`}
 title={()=>t(`step${step+1}Title`)} description={()=>t(`step${step+1}Body`)} action={t(step===2?'done':'next')} skipLabel={t('skip')} onSkip={finish} onAdvance={()=>step===2?finish():setStep(step+1)}/>
}
