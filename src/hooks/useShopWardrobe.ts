'use client'
import {createAvatarRequestCache} from '@/lib/avatar-request-cache'
import {useEffect,useState} from 'react'
import {useAuth} from '@/components/AuthProvider'
import type {ShopState} from '@/lib/avatar-shop'
export type SavedWardrobe=ShopState&{wins:number}
const wardrobes=createAvatarRequestCache<SavedWardrobe>()
export const SHOP_CHANGED='pn:wardrobe-updated'
export function useShopWardrobe(enabled=true){
 const {user}=useAuth()
 const userId=user?.id
 const [saved,setSaved]=useState<{userId:string;data:SavedWardrobe}|null>(null)
 const [failed,setFailed]=useState(false)
 const [deniedFor,setDeniedFor]=useState<string|null>(null)
 const [version,setVersion]=useState(0)
 useEffect(()=>{const reload=()=>setVersion(v=>v+1);window.addEventListener(SHOP_CHANGED,reload);window.addEventListener('focus',reload);return()=>{window.removeEventListener(SHOP_CHANGED,reload);window.removeEventListener('focus',reload)}},[])
 useEffect(()=>{
  if(!enabled||!userId)return
  let active=true
  wardrobes.read(userId,()=>fetch('/api/play/shop',{cache:'no-store',signal:AbortSignal.timeout(12_000)}).then(async response=>{if(!response.ok){if(response.status===404&&active)setDeniedFor(userId);throw Error()};return response.json()}),version>0).then(data=>{if(active){setSaved({userId,data});setFailed(false)}}).catch(()=>{if(active){setFailed(true)}})
  return()=>{active=false}
 },[enabled,userId,version])
 async function update(action:string,item?:string,avatar?:string){
  const response=await fetch('/api/play/shop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,item,avatar})})
  const data=await response.json()
  if(!response.ok)throw new Error(data.error??'save_failed')
  if(userId){wardrobes.prime(userId,data);setSaved({userId,data})}
  window.dispatchEvent(new Event(SHOP_CHANGED))
  window.dispatchEvent(new Event('pn:play-wallet-updated'))
  return data as SavedWardrobe
 }
 return {data:enabled&&userId?(saved?.userId===userId?saved.data:wardrobes.peek(userId)??null):null,failed,denied:deniedFor===userId,update,reload:()=>setVersion(v=>v+1)}
}
