'use client'
import {useEffect,useRef,useState,type ReactNode} from 'react'
import styles from './MemberAvatar.module.css'
const loaded=new Set<string>()
const pending=new Map<string,Promise<void>>()
function load(src:string){
 if(loaded.has(src))return Promise.resolve()
 const existing=pending.get(src);if(existing)return existing
 const request=new Promise<void>((resolve,reject)=>{
  const image=new window.Image()
  const timer=setTimeout(()=>{image.onload=null;image.onerror=null;reject(Error('avatar_timeout'))},8000)
  image.onload=()=>{clearTimeout(timer);loaded.add(src);resolve()}
  image.onerror=()=>{clearTimeout(timer);reject(Error('avatar_image'))}
  image.src=src
 }).finally(()=>pending.delete(src))
 pending.set(src,request);return request
}
/** Reveal a complete outfit together, instead of flashing disconnected layers. */
export function AvatarReady({identity,children}:{identity:string;children:ReactNode}){
 const root=useRef<HTMLSpanElement>(null)
 const [ready,setReady]=useState<string|null>(null)
 useEffect(()=>{
  let active=true
  const sources=[...new Set(Array.from(root.current?.querySelectorAll('image,img')??[]).map(el=>el.getAttribute('href')||el.getAttribute('src')||'').filter(Boolean))]
  // A missing optional layer must not permanently hide the correct character.
  Promise.allSettled(sources.map(load)).then(()=>{if(active)setReady(identity)})
  return()=>{active=false}
 },[identity])
 return <span ref={root} className={styles.readyFrame}>
  <span className={styles.readyArtwork} style={{opacity:ready===identity?1:0}}>{children}</span>
  {ready!==identity&&<span className={`${styles.loading} ${styles.readyPlaceholder}`} aria-hidden="true"/>}
 </span>
}

export function AvatarPlaceholder(){return <span aria-hidden="true" className={`${styles.readyFrame} ${styles.loading}`}/> }
