'use client'
import {useEffect,useState,useRef,type ReactNode} from 'react'
import {useTranslations} from 'next-intl'
import {useAuth} from '@/components/AuthProvider'
import {Figure} from './shop/WardrobeFigure'
import type {ShopState} from '@/lib/avatar-shop'
import styles from './MemberAvatar.module.css'
type Appearance=Pick<ShopState,'avatar'|'equipped'>
const requests=new Map<string,Promise<Appearance|null>>()
function readAppearance(viewer:string,user:string){
 const key=`${viewer}:${user}`
 let request=requests.get(key)
 if(!request){request=fetch(`/api/play/players/avatar?userId=${encodeURIComponent(user)}`,{cache:'no-store'}).then(async r=>r.ok?await r.json() as Appearance:null).catch(()=>null);requests.set(key,request);void request.finally(()=>requests.delete(key))}
 return request
}
export function MemberAvatar({userId,size=44,full=false,fallback}:{userId:string;size?:number;full?:boolean;fallback:ReactNode}){
 const {user}=useAuth()
 const [value,setValue]=useState<{key:string;appearance:Appearance}|null>(null)
 const key=`${user?.id}:${userId}`
 useEffect(()=>{
  if(!user?.id)return
  let active=true
  const refresh=()=>{void readAppearance(user.id,userId).then(appearance=>{if(active)setValue(appearance?{key,appearance}:null)})}
  refresh();window.addEventListener('focus',refresh);window.addEventListener('pn:wardrobe-updated',refresh)
  return()=>{active=false;window.removeEventListener('focus',refresh);window.removeEventListener('pn:wardrobe-updated',refresh)}
 },[user?.id,userId,key])
 const data=value?.key===key?value.appearance:null
 if(!data)return <>{fallback}</>
 const state:ShopState={...data,balance:0,owned:[]}
 return <span className={full?styles.full:styles.portrait} style={full?undefined:{width:size,height:size}}>
  <Figure state={state} preview={null} original portrait={!full} imageUrl={data.avatar.startsWith('custom:')?`/api/play/players/avatar?userId=${encodeURIComponent(userId)}&image=1`:undefined}/>
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
