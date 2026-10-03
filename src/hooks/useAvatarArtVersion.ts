'use client'
import {useEffect,useState} from 'react'
/** Do not briefly render a new A01 image through the old head/body cutouts. */
export function useAvatarArtVersion(source: string|null) {
 const [result,setResult]=useState<{source:string;version:'a01-v1'|'legacy'|'error'}|null>(null)
 useEffect(()=>{
  if(!source)return
  const controller=new AbortController()
  const url=source+(source.includes('?')?'&':'?')+'metadata=1'
  fetch(url,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   if(!response.ok)throw Error('Unavailable artwork')
   const data=await response.json()
   if(!controller.signal.aborted)setResult({source,version:data.artVersion==='a01-v1'?'a01-v1':'legacy'})
  }).catch(()=>{if(!controller.signal.aborted)setResult({source,version:'error'})})
  return()=>controller.abort()
 },[source])
 return source?(result?.source===source?result.version:'loading'):'legacy'
}
