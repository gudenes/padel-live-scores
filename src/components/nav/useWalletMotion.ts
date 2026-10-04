'use client'
import {useEffect,useState} from 'react'
type Change={id:string;from:number;to:number}
export function useWalletMotion(walletKey:string|undefined,balance:number|null,visible=true){
 const [frame,setFrame]=useState<{key:string;amount:number;direction:'gain'|'decrease'|null}|null>(null)
 useEffect(()=>{
  if(!visible||!walletKey||balance===null||!Number.isFinite(balance))return
  const controller=new AbortController()
  let raf=0,busy=false
  let stopAnimation:(()=>void)|undefined
  setFrame(null)
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)')
  const run=async()=>{
   if(document.hidden||busy)return
   busy=true
   try{
    const response=await fetch('/api/play/wallet/changes',{cache:'no-store',signal:controller.signal})
    if(!response.ok)return
    const {change}=await response.json() as {change:Change|null}
    if(!change||typeof change.id!=='string'||!Number.isFinite(change.from)||!Number.isFinite(change.to)||controller.signal.aborted||document.hidden)return
    const direction=change.to>change.from?'gain':'decrease'
    const duration=preference.matches?0:direction==='gain'?1300:650
    const start=performance.now()
    const completed=await new Promise<boolean>(resolve=>{
     stopAnimation=()=>{cancelAnimationFrame(raf);setFrame(null);resolve(false)}
     const tick=(now:number)=>{
      if(controller.signal.aborted||document.hidden){resolve(false);return}
      const progress=duration===0||preference.matches?1:Math.min(1,(now-start)/duration)
      setFrame({key:walletKey,amount:change.from+(change.to-change.from)*(1-(1-progress)**3),direction:progress<1?direction:null})
      if(progress<1)raf=requestAnimationFrame(tick);else resolve(true)
     }
     controller.signal.addEventListener('abort',()=>resolve(false),{once:true})
     tick(start)
    })
    // A hidden/unmounted wallet leaves the change pending for the next visit.
    if(completed&&!controller.signal.aborted&&!document.hidden)await fetch('/api/play/wallet/changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:change.id}),signal:controller.signal})
   }catch{/* History failure must never hide or block the actual wallet balance. */}
   finally{busy=false}
  }
  void run()
  const timer=setInterval(run,30000)
  const visibility=()=>{if(document.hidden)stopAnimation?.();else void run()}
  document.addEventListener('visibilitychange',visibility)
  return()=>{controller.abort();cancelAnimationFrame(raf);clearInterval(timer);document.removeEventListener('visibilitychange',visibility)}
 },[walletKey,balance,visible])
 return {amount:frame&&frame.key===walletKey&&frame.direction?frame.amount:balance,direction:frame&&frame.key===walletKey?frame.direction:null}
}
