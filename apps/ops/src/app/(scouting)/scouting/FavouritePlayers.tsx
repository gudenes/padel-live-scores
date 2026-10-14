'use client'
import {useEffect,useState,useRef} from 'react'
import Link from 'next/link'
import styles from './favourite-players.module.css'
type Player={id:string;name:string;avatar_url?:string}
export default function FavouritePlayers({userId,selected,profiles={}}:{userId:string;selected:string;profiles?:Record<string,string>}){
 const [saved,setSaved]=useState<Player[]>([]),[query,setQuery]=useState(''),[results,setResults]=useState<Player[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false)
 const dialog=useRef<HTMLDialogElement>(null)
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
  const next=remove?saved.filter(p=>p.id!==player.id):[...saved.filter(p=>p.id!==player.id),{id:player.id,name:player.name,avatar_url:player.avatar_url}]
  if(next.length>50){setError('You can save up to 50 players.');return}
  try{localStorage.setItem(key,JSON.stringify(next));setSaved(next);setError('');window.dispatchEvent(new Event('pn-watchlist-changed'))}catch{setError('Could not save your watchlist. Check browser storage and try again.')}
 }
 return <section className={styles.panel} aria-label="Watched players"><div className={styles.heading}><h2>WATCHED PLAYERS</h2><button type="button" className="ui-btn" data-variant="ghost" data-size="sm" aria-label="Manage watched players" title="Manage watched players" onClick={()=>dialog.current?.showModal()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
 <div className={styles.saved}>{saved.map(p=><div key={p.id}><Link className="ui-btn" data-size="sm" data-variant={selected===p.id?'primary':'ghost'} href={'/scouting?player='+p.id}>{(p.avatar_url||profiles[p.id])&&<img src={p.avatar_url||profiles[p.id]} alt="" width={32} height={32}/>}<span>{p.name}</span></Link></div>)}{!saved.length&&ready&&<p>Use the settings icon to add players.</p>}{selected&&<Link className="ui-btn" data-size="sm" data-variant="ghost" href="/scouting?view=all">Show all matches</Link>}</div>
 <dialog ref={dialog} className={styles.dialog} aria-labelledby="watched-players-title" onClick={e=>{if(e.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.current.close()}}}>
 <div className={styles.modalHeading}><div><h3 id="watched-players-title">Your watched players</h3><p>Choose players to follow their latest matches.</p></div><button type="button" className="ui-btn" data-variant="ghost" aria-label="Close player settings" onClick={()=>dialog.current?.close()}>×</button></div>
 <label className={styles.search}>Find a player<input autoFocus className="ui-input" placeholder="Type at least 3 letters…" value={query} onChange={e=>setQuery(e.target.value)} disabled={!ready}/></label>
 <div role="status">{busy?'Searching players…':error||(!busy&&query.trim().length>=3&&!results.length?'No players found.':'')}</div>
 <h4>{query.trim().length>=3?'Search results':`Watching · ${saved.length}/50`}</h4>
 <ul>{(query.trim().length>=3?results:saved).map(p=>{const watching=saved.some(s=>s.id===p.id);return <li key={p.id}><div className={styles.player}>{(p.avatar_url||profiles[p.id])?<img src={p.avatar_url||profiles[p.id]} alt="" width={36} height={36}/>:<span className={styles.initial}>{p.name.charAt(0)}</span>}<span>{p.name}</span></div><button type="button" className="ui-btn" data-variant={watching?'primary':'default'} aria-pressed={watching} aria-label={(watching?'Unwatch ':'Watch ')+p.name} onClick={()=>save(p,watching)}>{watching?'✓ Watching':'+ Watch'}</button></li>})}</ul>
 {!saved.length&&query.trim().length<3&&<p>Search above to add your first player.</p>}
 <div className={styles.footer}><small>Saved automatically in this browser.</small><button type="button" className="ui-btn" data-variant="primary" onClick={()=>dialog.current?.close()}>Done</button></div>
 </dialog></section>
}
