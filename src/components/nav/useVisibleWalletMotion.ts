'use client'
import {useEffect,useRef,useState} from 'react'
import {useWalletMotion} from './useWalletMotion'
export function useVisibleWalletMotion(walletKey:string|undefined,balance:number|null){
 const ref=useRef<HTMLDivElement>(null)
 const [visible,setVisible]=useState(false)
 useEffect(()=>{
  if(!ref.current)return
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>0)))
  observer.observe(ref.current)
  return()=>observer.disconnect()
 },[])
 return {ref,...useWalletMotion(walletKey,balance,visible)}
}
