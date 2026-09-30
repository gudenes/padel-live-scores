'use client'
import {useEffect,useCallback,useSyncExternalStore} from 'react'
import type {EarnedBadge} from './useBadges'
const key=(id:string)=>`pn_badges_seen:${id}`
const pair=(b:EarnedBadge)=>`${b.badge_id}:${b.tier}`
const change='pn-badges-seen'
function subscribe(update:()=>void){
 window.addEventListener(change,update);window.addEventListener('storage',update)
 return()=>{window.removeEventListener(change,update);window.removeEventListener('storage',update)}
}
export function countUnreadBadges(badges:EarnedBadge[],raw:string|null){
 try{const parsed:unknown=raw?JSON.parse(raw):[];const seen=new Set(Array.isArray(parsed)?parsed:[]);return badges.filter(b=>!seen.has(pair(b))).length}
 catch{return 0}
}
export function useBadgeUnread(userId:string|undefined,badges:EarnedBadge[],loading:boolean,visible:boolean){
 const snapshot=useCallback(()=>{try{return userId?localStorage.getItem(key(userId)):null}catch{return null}},[userId])
 const seen=useSyncExternalStore(subscribe,snapshot,()=>null)
 useEffect(()=>{
  if(!userId||loading)return
  try{
   const migrate=seen===null&&Number(localStorage.getItem('pn_seen_badge_count')??0)>=badges.length
   if(visible||migrate){
    const next=JSON.stringify(badges.map(pair))
    if(next!==seen){localStorage.setItem(key(userId),next);localStorage.setItem('pn_seen_badge_count',String(badges.length));window.dispatchEvent(new Event(change))}
   }
  }catch{}
 },[userId,badges,loading,visible,seen])
 return loading||visible||!userId?0:countUnreadBadges(badges,seen)
}
