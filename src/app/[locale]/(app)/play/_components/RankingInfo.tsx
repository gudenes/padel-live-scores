'use client'
import {useEffect,useId,useRef,useState} from 'react'
import {useTranslations} from 'next-intl'
import styles from './LeadersScreen.module.css'
export default function RankingInfo({weekly}:{weekly:boolean}){
 const t=useTranslations('play.leaders'),id=useId(),root=useRef<HTMLDivElement>(null)
 const [pinned,setPinned]=useState(false),[hover,setHover]=useState(false)
 const open=pinned||hover
 useEffect(()=>{
  if(!open)return
  const close=()=>{setPinned(false);setHover(false)}
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))close()}
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();close()}}
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key)
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key)}
 },[open])
 return <div ref={root} className={styles.rankingInfo} onPointerEnter={e=>{if(e.pointerType==='mouse')setHover(true)}} onPointerLeave={()=>setHover(false)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)){setPinned(false);setHover(false)}}}>
  <button type="button" className="pn-press shape-chunky-tilted intent-neutral size-sm" aria-label={t('rankingInfo')} aria-expanded={open} aria-describedby={open?id:undefined} onFocus={e=>{if(e.currentTarget.matches(':focus-visible'))setHover(true)}} onClick={()=>{setHover(false);setPinned(v=>!v)}}>
   <span className="pn-press-skirt" aria-hidden="true"/><span className="pn-press-face" aria-hidden="true">i</span>
  </button>
  {open&&<div id={id} role="tooltip" className={styles.rankingTooltip}>{t('note')}{weekly&&<> {t('weekScope')}</>}</div>}
 </div>
}
