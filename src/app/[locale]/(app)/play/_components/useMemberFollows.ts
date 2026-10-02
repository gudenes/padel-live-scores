'use client'
import {useEffect,useState} from 'react'
export function useMemberFollows(active:boolean){
 const [ids,setIds]=useState<string[]>([])
 const [ready,setReady]=useState(false)
 const [error,setError]=useState(false)
 const [busy,setBusy]=useState(false)
 useEffect(()=>{
  if(!active)return
  let current=true
  const load=()=>{void fetch('/api/play/follows',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(current){setIds(d.followingIds);setReady(true);setError(false)}}).catch(()=>{if(current)setError(true)})}
  load();window.addEventListener('focus',load)
  return()=>{current=false;window.removeEventListener('focus',load)}
 },[active])
 async function toggle(id:string){
  if(busy||!ready)return false
  setBusy(true);setError(false)
  const follow=!ids.includes(id)
  try{
   const r=await fetch('/api/play/follows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:id,follow})})
   if(!r.ok)throw Error()
   setIds(current=>follow?[...new Set([...current,id])]:current.filter(value=>value!==id));return true
  }catch{setError(true);return false}finally{setBusy(false)}
 }
 return {ids,ready,error,busy,toggle}
}
