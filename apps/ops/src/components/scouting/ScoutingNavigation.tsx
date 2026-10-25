'use client'
import {createContext, Suspense, useContext, useEffect, useState} from 'react'
import Link from 'next/link'
import {usePathname, useSearchParams} from 'next/navigation'
import {scoutingEntity, scoutingPath} from '@/lib/scouting/navigation'

type Crumb = {href:string; label:string}
type Position = {windowY:number; mainY:number; focusHref?:string}
type NavigationState = {trails:Record<string,Crumb[]>; positions:Record<string,Position>; pending?:string; leaving?:string}
const StorageKey = createContext('')
function read(key:string):NavigationState {try {const value=JSON.parse(sessionStorage.getItem(key)||'{}');return {trails:value.trails||{},positions:value.positions||{},pending:value.pending,leaving:value.leaving}} catch {return {trails:{},positions:{}}}}
function write(key:string,state:NavigationState){try{sessionStorage.setItem(key,JSON.stringify(state))}catch{/* Navigation still works without browser storage. */}}
function here(){return location.pathname+location.search+location.hash}
function main(){return document.querySelector<HTMLElement>('main.main')}
function label(path:string){
 const url=new URL(path,location.origin)
 if(url.pathname==='/scouting')return 'matches'
 if(url.pathname==='/scouting/players')return url.searchParams.has('player')?(document.querySelector('h1')?.textContent?.trim()||'player profile'):(url.searchParams.get('view')==='pairs'?'pairs':'players')
 return 'match report'
}
function Tracker(){
 const key=useContext(StorageKey),pathname=usePathname(),params=useSearchParams(),route=pathname+'?'+params.toString()
 const [historyChange,setHistoryChange]=useState(0)
 useEffect(()=>{
  const capture=(event:MouseEvent)=>{
   if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return
   const from=here(),state=read(key)
   if(!scoutingPath(from))return
   state.positions[from]={windowY:window.scrollY,mainY:main()?.scrollTop||0}
   write(key,state)
   const link=(event.target as Element)?.closest<HTMLAnchorElement>('a[href]')
   if(!link||link.target==='_blank'||link.hasAttribute('download'))return
   const url=new URL(link.href,location.origin)
   if(url.origin!==location.origin)return
   const to=scoutingPath(url.pathname+url.search+url.hash)
   if(!to||!scoutingPath(from))return
   state.positions[from]={windowY:window.scrollY,mainY:main()?.scrollTop||0,focusHref:link.getAttribute('href')||undefined}
   if(!link.hasAttribute('data-scout-back')&&scoutingEntity(to)!==scoutingEntity(from)){
    state.trails[scoutingEntity(to)]=[...(state.trails[scoutingEntity(from)]||[]),{href:from,label:label(from)}].slice(-20)
   }
   if(to!==from)state.leaving=from
   // Bound session storage without dropping the most recent positions.
   const entries=Object.entries(state.positions);if(entries.length>100)state.positions=Object.fromEntries(entries.slice(-100))
   write(key,state)
  }
  const pop=()=>{const state=read(key);state.pending=here();write(key,state);setHistoryChange(value=>value+1)}
  let scrollTimer:ReturnType<typeof setTimeout>
  const saveScroll=()=>{const path=here();clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{const state=read(key);if(state.pending||state.leaving===path||here()!==path)return;state.positions[path]={...state.positions[path],windowY:window.scrollY,mainY:main()?.scrollTop||0};write(key,state)},100)}
  document.addEventListener('scroll',saveScroll,true);
  document.addEventListener('click',capture,true);window.addEventListener('popstate',pop)
  return()=>{clearTimeout(scrollTimer);document.removeEventListener('scroll',saveScroll,true);document.removeEventListener('click',capture,true);window.removeEventListener('popstate',pop)}
 },[key])
 useEffect(()=>{
  const state=read(key),path=here()
  if(state.leaving&&state.leaving!==path){delete state.leaving;write(key,state)}
  if(state.pending!==path)return
  const position=state.positions[path];if(!position){delete state.pending;write(key,state);return}
  let stopped=false,frame=0,stable=0
  const started=Date.now(),deadline=started+12000
  const stop=()=>{stopped=true;cancelAnimationFrame(frame);const next=read(key);delete next.pending;write(key,next)}
  const restore=()=>{
   if(stopped)return
   const container=main()
   // Profiles load asynchronously; wait until the requested position exists.
   window.scrollTo({top:position.windowY,behavior:'instant'})
   container?.scrollTo({top:position.mainY,behavior:'instant'})
   const busy=document.querySelector('[data-navigation-loading="true"]')
   const reached=Math.abs((container?.scrollTop||0)-position.mainY)<3&&Math.abs(window.scrollY-position.windowY)<3
   stable=!busy&&reached?stable+1:0
   if((stable>=8&&Date.now()-started>1000)||Date.now()>deadline){
    const links=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    links.find(a=>a.getAttribute('href')===position.focusHref)?.focus({preventScroll:true})
    stop();return
   }
   frame=requestAnimationFrame(restore)
  }
  frame=requestAnimationFrame(restore)
  window.addEventListener('wheel',stop,{once:true,passive:true});window.addEventListener('touchstart',stop,{once:true,passive:true});window.addEventListener('keydown',stop,{once:true})
  return()=>{stopped=true;cancelAnimationFrame(frame);window.removeEventListener('wheel',stop);window.removeEventListener('touchstart',stop);window.removeEventListener('keydown',stop)}
 },[route,key,historyChange])
 return null
}
export function ScoutingNavigation({children,userId}:{children:React.ReactNode;userId:string}){
 return <StorageKey.Provider value={'pn-scout-navigation:'+userId}><Suspense><Tracker/></Suspense>{children}</StorageKey.Provider>
}
export function ScoutingBackLink({fallback='/scouting?view=all',fallbackLabel='matches',className='ui-btn'}:{fallback?:string;fallbackLabel?:string;className?:string}){
 const key=useContext(StorageKey),pathname=usePathname(),params=useSearchParams(),route=pathname+'?'+params.toString()
 const [crumb,setCrumb]=useState<Crumb|null>(null)
 useEffect(()=>{const trail=read(key).trails[scoutingEntity(here())]||[];const legacy=scoutingPath(params.get('returnTo'));setCrumb(trail.at(-1)|| (legacy?{href:legacy,label:legacy.startsWith('/scouting/players')?'player analysis':'matches'}:null))},[route,key])
 const target=crumb?.href||scoutingPath(fallback)||'/scouting?view=all'
 return <Link className={className} data-variant="ghost" data-scout-back="true" href={target} scroll={false} onClick={e=>{
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return
  const state=read(key),trail=state.trails[scoutingEntity(here())]||[]
  if(crumb&&trail.at(-1)?.href===target)state.trails[scoutingEntity(target)]=trail.slice(0,-1)
  state.pending=target;write(key,state)
 }}>← Back to {crumb?.label||fallbackLabel}</Link>
}
