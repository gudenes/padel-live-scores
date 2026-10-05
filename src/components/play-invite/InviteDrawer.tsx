'use client'
import {useEffect,useRef} from 'react'
import {useTranslations} from 'next-intl'
import {useSwipeDownToClose} from '@/hooks/useSwipeDownToClose'
import InviteExperience from './InviteExperience'
import styles from './InviteDrawer.module.css'
export default function InviteDrawer({onClose,preview=false}:{onClose:()=>void;preview?:boolean}){
 const ref=useRef<HTMLDialogElement>(null),sheet=useRef<HTMLDivElement>(null),t=useTranslations('play.invite')
 const swipe=useSwipeDownToClose({onClose,scrollRef:sheet})
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();previous?.focus({preventScroll:true})}},[])
 return <dialog ref={ref} className={styles.dialog} aria-label={t('title')} onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div ref={sheet} className={styles.sheet} {...swipe.bind} style={swipe.style}>
   <div className={styles.handle} aria-hidden="true"/>
   <InviteExperience mode="share" preview={preview} drawer onClose={onClose}/>
  </div>
 </dialog>
}
