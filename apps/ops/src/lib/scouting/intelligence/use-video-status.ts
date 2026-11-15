'use client'
import {useEffect,useState} from 'react'
import type {VideoStatusDetail} from './video-status'
export function useVideoStatus(keys:string){
 const [state,setState]=useState<{keys:string;statuses:Record<string,VideoStatusDetail>}>({keys:'',statuses:{}})
 useEffect(()=>{
  if(!keys)return
  let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController()
  async function refresh(){clearTimeout(timer);
   try{
    if(document.visibilityState==='visible'){
     const response=await fetch('/api/internal/scouting-intelligence/video-status?'+new URLSearchParams({matches:keys}),{signal:controller.signal,cache:'no-store'})
     if(!response.ok)throw Error('Status unavailable')
     const {statuses}=await response.json();if(!stopped)setState({keys,statuses})
    }
   }catch{if(!stopped)setState({keys,statuses:{}})}
   finally{if(!stopped)timer=setTimeout(refresh,20000)}
  }
  void refresh();window.addEventListener('video-queue-changed',refresh);return()=>{window.removeEventListener('video-queue-changed',refresh);stopped=true;controller.abort();clearTimeout(timer)}
 },[keys])
 return state.keys===keys?state.statuses:{}
}
