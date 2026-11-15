'use client'
import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import Link from 'next/link'
import {Icon} from '@/components/IconSprite'
import {analysisStageName,videoStatusLabel,type VideoStatusDetail,type VideoQueueItem} from '@/lib/scouting/intelligence/video-status'
import styles from './intelligence.module.css'

function QueuePanel({close}:{close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null)
 const [queue,setQueue]=useState<VideoQueueItem[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[canCancel,setCanCancel]=useState(false)
 useEffect(()=>{dialog.current?.showModal()},[])
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>
  async function refresh(){clearTimeout(timer);try{const res=await fetch('/api/internal/scouting-intelligence/video-status',{signal:controller.signal,cache:'no-store'});if(!res.ok)throw Error('Could not load the queue.');const data=await res.json();setQueue(data.queue);setCanCancel(data.canCancel);setLoaded(true);setError('')}catch(e){if(!controller.signal.aborted)setError((e as Error).message)}finally{if(!controller.signal.aborted)timer=setTimeout(refresh,20000)}}
  void refresh();window.addEventListener('video-queue-changed',refresh)
  return()=>{controller.abort();clearTimeout(timer);window.removeEventListener('video-queue-changed',refresh)}
 },[])
 async function cancel(id:string){setBusy(id);setError('');try{const res=await fetch('/api/internal/lab-vision/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancelQueued',id})});const data=await res.json();if(!res.ok)throw Error(data.error||'Could not cancel this job.');setQueue(q=>q.filter(j=>j.id!==id));window.dispatchEvent(new Event('video-queue-changed'))}catch(e){setError((e as Error).message)}finally{setBusy(null)}}
 return createPortal(<dialog ref={dialog} className={styles.videoQueuePanel} aria-labelledby="video-queue-title" onCancel={close} onClose={close}>
  <header><h2 id="video-queue-title">Your video queue</h2><button className="ui-btn" onClick={close} aria-label="Close video queue">Close</button></header>
  <p>Waiting videos run oldest first. Each connected Mac processes one video at a time.</p>
  {error&&<p role="alert">{error}</p>}
  {!loaded&&!error&&<p role="status">Loading queue…</p>}
  {loaded&&!queue.length&&<p>No videos waiting or processing.</p>}
  {!!queue.length&&!queue.some(j=>j.online)&&<p role="status">Your Mac is offline. Connect your worker to continue processing.</p>}
  <ul>{[...queue].sort((a,b)=>Number(a.state==='queued')-Number(b.state==='queued')).map(j=><li key={j.id}>
   <Link href={`/scouting/${j.kind==='manual'?'manual/':''}${j.matchId}/report?analysis=1`}>{j.name}</Link>
   <div><span className={styles.videoBadge} data-state={j.state}>{videoStatusLabel(j)}</span>{j.state==='queued'&&canCancel&&<button className="ui-btn" disabled={!!busy} onClick={()=>void cancel(j.id)}>{busy===j.id?'Cancelling…':'Cancel queued video'}</button>}</div>
   {j.state==='processing'&&<small>{analysisStageName(j.stage)}{j.percent!=null?` · ${j.percent}% of this stage`:''}</small>}
   {j.state==='processing'&&j.percent!=null&&<progress aria-label={`${analysisStageName(j.stage)} progress`} value={j.percent} max={100}/>}
  </li>)}</ul>
 </dialog>,document.body)
}
export function VideoQueueButton(){const [open,setOpen]=useState(false);return <><button className="ui-btn" onClick={()=>setOpen(true)}>Video queue</button>{open&&<QueuePanel close={()=>setOpen(false)}/>}</>}
export function MatchVideoBadge({status,href,names}:{status:VideoStatusDetail;href:string;names:string}){
 const [open,setOpen]=useState(false)
 const label=videoStatusLabel(status),help=status.state==='ready'?'Hosted video and analysis ready — open video review':status.state==='queued'?'Waiting for an available Mac · oldest first':`${analysisStageName(status.stage)}${status.percent!=null?` · ${status.percent}% of this stage`:''}`
 const content=<><Icon id={status.state==='ready'?'play':'retry'}/><span>{label}</span></>
 return <>{status.owned&&status.state!=='ready'?<button className={styles.videoBadge} data-state={status.state} title={help} aria-label={`${label} · ${help} · ${names} · Open video queue`} onClick={()=>setOpen(true)}>{content}</button>:<Link prefetch={false} className={styles.videoBadge} data-state={status.state} href={href} title={help} aria-label={`${label} · ${names}`}>{content}</Link>}{open&&<QueuePanel close={()=>setOpen(false)}/>}</>
}
