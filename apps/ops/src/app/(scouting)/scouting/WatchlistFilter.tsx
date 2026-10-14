'use client'
import {useEffect,useState,useTransition} from 'react'
import {useRouter} from 'next/navigation'
import {catalogFilters,catalogUrl,type CatalogFilters} from '@/lib/scouting/match-catalog'

export default function WatchlistFilter({userId,filters}:{userId:string;filters:CatalogFilters}){
 const router=useRouter(),[pending,startTransition]=useTransition(),[error,setError]=useState('')
 const key='pn-admin-favourite-players:'+userId
 function readPlayers(){
  const saved=JSON.parse(localStorage.getItem(key)??'[]')
  return catalogFilters({watchlist:'1',watched:Array.isArray(saved)?saved.map(p=>p?.id).join(','):''}).watched
 }
 useEffect(()=>{
  function sync(){
   if(!filters.watchlist)return
   try{const watched=readPlayers();if(watched!==filters.watched)router.replace(catalogUrl(filters,{watched,page:1}),{scroll:false})}catch{setError('Could not read your watchlist in this browser.')}
  }
  sync()
  window.addEventListener('pn-watchlist-changed',sync)
  window.addEventListener('storage',sync)
  return()=>{window.removeEventListener('pn-watchlist-changed',sync);window.removeEventListener('storage',sync)}
 },[key,filters,router])
 function toggle(){
  try{
   const active=!!filters.watchlist
   const href=catalogUrl(filters,{watchlist:active?'':'1',watched:active?'':readPlayers(),player:'',mine:'',page:1})
   setError('');startTransition(()=>router.push(href,{scroll:false}))
  }catch{setError('Could not read your watchlist in this browser.')}
 }
 return <><button type="button" className="ui-btn" data-variant={filters.watchlist?'primary':'ghost'} aria-pressed={!!filters.watchlist} disabled={pending} onClick={toggle}>My Watchlist</button>{error&&<span role="alert">{error}</span>}</>
}
