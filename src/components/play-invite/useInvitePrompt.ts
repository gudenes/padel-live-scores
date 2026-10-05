'use client'
import {useCallback,useEffect,useState} from 'react'
export function useInvitePrompt(userId:string|undefined,blocked:boolean,preview=false){
 const [open,setOpen]=useState(false),[pending,setPending]=useState(false)
 const key=`pn:invite-first-play:${userId??'preview'}`
 useEffect(()=>{setOpen(false);setPending(false)},[userId])
 const afterPrediction=useCallback(async()=>{
  try{
   if(localStorage.getItem(key))return
   if(preview){setPending(true);return}
   const response=await fetch('/api/play/invites/prompt',{cache:'no-store'})
   if(response.ok&&(await response.json()).eligible)setPending(true)
  }catch{/* An invitation must never interrupt a successful prediction. */}
 },[key,preview])
 useEffect(()=>{
  if(!pending||blocked)return
  setPending(false)
  try{if(localStorage.getItem(key))return;localStorage.setItem(key,'seen')}catch{/* Storage may be unavailable; first-play eligibility still limits the prompt. */}
  setOpen(true)
 },[pending,blocked,key])
 useEffect(()=>{const show=()=>setOpen(true);window.addEventListener('pn:invite-play',show);return()=>window.removeEventListener('pn:invite-play',show)},[])
 return {open,show:()=>setOpen(true),close:()=>setOpen(false),afterPrediction}
}
