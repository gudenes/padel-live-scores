'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import styles from './favourite-players.module.css'
type Player={id:string;name:string}
export default function FavouritePlayers({userId,selected}:{userId:string;selected:string}){
 const [saved,setSaved]=useState<Player[]>([]),[query,setQuery]=useState(''),[results,setResults]=useState<Player[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false)
 const key='pn-admin-favourite-players:'+userId
 useEffect(()=>{setReady(false);try{const data=JSON.parse(localStorage.getItem(key)??'[]');setSaved(Array.isArray(data)?data.filter(p=>typeof p?.name==='string'&&/^[0-9a-f-]{36}$/i.test(p?.id)).slice(0,50):[])}catch{setError('Your watchlist could not be read on this browser.')}setReady(true)},[key])
 useEffect(()=>{
  setResults([]);setBusy(false)
  if(query.trim().length<3)return
  setBusy(true)
  const controller=new AbortController()
  const timer=setTimeout(async()=>{setBusy(true);setError('');try{const res=await fetch('/api/internal/scouting-player-search?q='+encodeURIComponent(query.trim()),{signal:controller.signal});const body=await res.json();if(!res.ok)throw Error(body.error);if(!controller.signal.aborted)setResults(body.players)}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Search unavailable.')}finally{if(!controller.signal.aborted)setBusy(false)}},300)
  return()=>{clearTimeout(timer);controller.abort()}
 },[query])
 function save(player:Player,remove=false){
  const next=remove?saved.filter(p=>p.id!==player.id):[...saved.filter(p=>p.id!==player.id),{id:player.id,name:player.name}]
  if(next.length>50){setError('You can save up to 50 players.');return}
  try{localStorage.setItem(key,JSON.stringify(next));setSaved(next);setError('')}catch{setError('Could not save your watchlist. Check browser storage and try again.')}
 }
 return <section className={styles.panel} aria-label="Watchlist"><details open={!!selected||undefined}>
 <summary><span>☆ Watchlist</span><small>{saved.length} saved · View up to 10 matches per player</small></summary>
 <p>Saved for your account in this browser. Live matches first, then upcoming matches and recent results.</p>
 <div className={styles.saved}>{saved.map(p=><div key={p.id}><Link className="ui-btn" data-size="sm" data-variant={selected===p.id?'primary':'ghost'} href={'/scouting?player='+p.id}>{p.name}</Link><button type="button" className="ui-btn" data-variant="ghost" data-size="sm" aria-label={'Remove '+p.name+' from watchlist'} onClick={()=>save(p,true)}>×</button></div>)}{selected&&<Link className="ui-btn" data-size="sm" data-variant="ghost" href="/scouting">Show all matches</Link>}</div>
 <label className={styles.search}>Add a player<input className="ui-input" placeholder="Type at least 3 letters…" value={query} onChange={e=>setQuery(e.target.value)} disabled={!ready}/></label>
 <div role="status">{busy?'Searching players…':error||(!busy&&query.trim().length>=3&&!results.length?'No players found.':'')}</div>
 <ul>{results.map(p=><li key={p.id}><Link className="ui-btn" data-variant="ghost" href={'/scouting?player='+p.id}>{p.name}</Link><button type="button" className="ui-btn" data-variant={saved.some(s=>s.id===p.id)?'primary':'ghost'} aria-label={(saved.some(s=>s.id===p.id)?'Unsave ':'Save ')+p.name} onClick={()=>save(p,saved.some(s=>s.id===p.id))}>{saved.some(s=>s.id===p.id)?'★ Saved':'☆ Save'}</button></li>)}</ul>
 </details></section>
}
