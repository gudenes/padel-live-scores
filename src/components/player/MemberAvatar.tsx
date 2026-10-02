'use client'
import {createAvatarRequestCache} from '@/lib/avatar-request-cache'
import {useEffect,useState,useRef,type ReactNode} from 'react'
import {useTranslations} from 'next-intl'
import {useAuth} from '@/components/AuthProvider'
import {AvatarReady} from './AvatarReady'
import {Figure} from './shop/WardrobeFigure'
import {ShopProfileAvatar,ShopProfileFigure} from './shop/AvatarShop'
import type {ShopState} from '@/lib/avatar-shop'
import styles from './MemberAvatar.module.css'
type Appearance=Pick<ShopState,'avatar'|'equipped'>
const appearances=createAvatarRequestCache<Appearance>()
function placeholder(size:number,full:boolean){return <span aria-hidden="true" className={`${full?styles.full:styles.portrait} ${styles.loading}`} style={full?undefined:{width:size,height:size}}/>}
export function MemberAvatar({userId,size=44,full=false,fallback}:{userId:string;size?:number;full?:boolean;fallback:ReactNode}){
 const {user}=useAuth()
 const neutral=placeholder(size,full)
 if(user?.id===userId)return full?<ShopProfileFigure className={styles.full} fallback={neutral}/>:<ShopProfileAvatar size={size} fallback={neutral}/>
 return <SavedMemberAvatar userId={userId} size={size} full={full} fallback={fallback}/>
}
function SavedMemberAvatar({userId,size,full,fallback}:{userId:string;size:number;full:boolean;fallback:ReactNode}){
 const {user}=useAuth()
 const key=`${user?.id}:${userId}`
 const [unavailable,setUnavailable]=useState<string|null>(null)
 const [value,setValue]=useState<{key:string;appearance:Appearance}|null>(()=>{const appearance=appearances.peek(key);return appearance?{key,appearance}:null})
 useEffect(()=>{
  if(!user?.id)return
  let active=true
  let retry:ReturnType<typeof setTimeout>|undefined
  let retried=false
  const refresh=(force=false)=>{void appearances.read(key,async()=>{
   const response=await fetch(`/api/play/players/avatar?userId=${encodeURIComponent(userId)}`,{cache:'no-store',signal:AbortSignal.timeout(12_000)})
   if(!response.ok){if(response.status===404&&active)setUnavailable(key);throw Error('avatar_unavailable')}
   return await response.json() as Appearance
  },force).then(appearance=>{if(active)setValue({key,appearance})}).catch(()=>{
    // Retry a cold/slow first request once, while preserving any cached appearance.
    if(active&&!retried){retried=true;retry=setTimeout(()=>refresh(),2000)}
   })}
  const focus=()=>refresh(),changed=()=>refresh(true)
  refresh();window.addEventListener('focus',focus);window.addEventListener('pn:wardrobe-updated',changed)
  return()=>{active=false;clearTimeout(retry);window.removeEventListener('focus',focus);window.removeEventListener('pn:wardrobe-updated',changed)}
 },[user?.id,userId,key])
 const data=value?.key===key?value.appearance:appearances.peek(key)
 if(!data)return unavailable===key?<>{fallback}</>:placeholder(size,full)
 const state:ShopState={...data,balance:0,owned:[]}
 return <span className={full?styles.full:styles.portrait} style={full?undefined:{width:size,height:size}}>
  <AvatarReady identity={JSON.stringify([data.avatar,data.equipped,full])}><Figure state={state} preview={null} original portrait={!full} imageUrl={data.avatar.startsWith('custom:')?`/api/play/players/avatar?userId=${encodeURIComponent(userId)}&image=1`:undefined}/></AvatarReady>
 </span>
}
export function MemberAvatarButton({userId,name,size=42,fallback}:{userId:string;name:string;size?:number;fallback:ReactNode}){
 const [open,setOpen]=useState(false)
 const t=useTranslations('play')
 return <><button type="button" className={styles.button} aria-label={`${t('leaders.player')}: ${name}`} onClick={()=>setOpen(true)}><MemberAvatar userId={userId} size={size} fallback={fallback}/></button>
 {open&&<MemberPreview userId={userId} name={name} fallback={fallback} onClose={()=>setOpen(false)}/>}</>
}
function MemberPreview({userId,name,fallback,onClose}:{userId:string;name:string;fallback:ReactNode;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),t=useTranslations('play')
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const el=dialog.current;el?.showModal();return()=>{el?.close();previous?.focus()}},[])
 return <dialog ref={dialog} className={styles.dialog} aria-label={name} onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}><header><h2>{name}</h2><button type="button" aria-label={t('detail.close')} onClick={onClose}>×</button></header><MemberAvatar userId={userId} full fallback={fallback}/></dialog>
}
