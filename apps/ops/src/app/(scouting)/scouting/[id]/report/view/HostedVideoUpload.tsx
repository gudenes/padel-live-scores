'use client'
import {useEffect,useRef,useState} from 'react'
import type {ReviewContext} from './ReviewNotes'
export type HostedVideo={id:string;name:string;size:number;url:string;offset:number;duration:number;expiresAt:number}
export default function HostedVideoUpload({context,file,offset,duration,onHosted}:{context:ReviewContext;file:File|null;offset:number;duration:number;onHosted:(v:HostedVideo)=>void}){
 const endpoint=`/api/internal/match-video/${context.matchId}?kind=${context.manual?'manual':'canonical'}`
 const [configured,setConfigured]=useState<boolean|null>(null),[canUpload,setCanUpload]=useState(false),[hosted,setHosted]=useState<HostedVideo|null>(null)
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[message,setMessage]=useState(''),[error,setError]=useState('')
 const stop=useRef(false),xhr=useRef<XMLHttpRequest|null>(null),callback=useRef(onHosted);callback.current=onHosted
 useEffect(()=>{let active=true;fetch(endpoint,{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(active){setConfigured(d.configured);setCanUpload(d.canUpload);setHosted(d.video);if(d.video)callback.current(d.video)}}).catch(()=>{if(active)setError('Could not load hosted video. Refresh to retry.')});return()=>{active=false;stop.current=true;xhr.current?.abort()}},[endpoint])
 const storageKey=file?`match-video-upload:${context.userId}:${context.matchId}:${context.manual}:${file.name}:${file.size}:${file.lastModified}:${offset}`:''
 async function api(body:unknown){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Upload step failed.');return d}
 function send(url:string,chunk:Blob,onProgress:(n:number)=>void){return new Promise<void>((resolve,reject)=>{const req=new XMLHttpRequest();xhr.current=req;req.open('PUT',url);req.timeout=600000;req.upload.onprogress=e=>onProgress(e.loaded);req.onload=()=>req.status>=200&&req.status<300?resolve():reject(Error('Part upload failed. Try resuming.'));req.onerror=()=>reject(Error('Connection interrupted. Try resuming.'));req.ontimeout=()=>reject(Error('Upload timed out. Try resuming.'));req.onabort=()=>reject(Error('Upload paused.'));req.send(chunk)})}
 async function upload(){
  if(!file||busy)return;setBusy(true);setError('');stop.current=false
  let id='';try{
   try{id=localStorage.getItem(storageKey)||''}catch{}
   if(!id){id=crypto.randomUUID();try{localStorage.setItem(storageKey,id)}catch{}}
   setMessage('Preparing upload…')
   const state=await api({action:'start',id,name:file.name,size:file.size,offset,duration})
   if(state.ready){setHosted(state.video);callback.current(state.video);setMessage('Video is available online.');return}
   const count=Math.ceil(file.size/state.partSize),done=new Set<number>(state.parts.filter((p:any)=>p.size===Math.min(state.partSize,file.size-(p.number-1)*state.partSize)).map((p:any)=>p.number))
   let sent=[...done].reduce((n,p)=>n+Math.min(state.partSize,file.size-(p-1)*state.partSize),0)
   setProgress(sent/file.size*100)
   for(let n=1;n<=count;n++){
    if(stop.current)throw Error('Upload paused.');if(done.has(n))continue
    setMessage(`Uploading part ${n} of ${count}…`)
    const part=await api({action:'part',id,part:n}),chunk=file.slice((n-1)*state.partSize,Math.min(n*state.partSize,file.size))
    if(stop.current)throw Error('Upload paused.')
    await send(part.url,chunk,bytes=>setProgress((sent+bytes)/file.size*100));sent+=chunk.size
   }
   setMessage('Verifying and attaching video…')
   const result=await api({action:'complete',id});setHosted(result.video);callback.current(result.video);setProgress(100);setMessage('Video is available online. Processing still runs on your Mac.');try{localStorage.removeItem(storageKey)}catch{}
  }catch(e){setError(e instanceof Error?e.message:'Upload interrupted.');setMessage('Choose the same file and resume to keep completed parts.')}finally{setBusy(false);xhr.current=null}
 }
 return <section className="vr-hosted-upload" aria-label="Online match video">
 <div><strong>{hosted?'Video hosted online':'Online video'}</strong><small>{hosted?hosted.name:'Upload once to review this match from another device.'}</small></div>
 {configured===false&&<p>Cloudflare storage is awaiting connection. Local video review is still available.</p>}
 {configured&&canUpload&&<div className="vr-hosted-actions">{file?<button className="ui-btn" disabled={busy||duration<=0} onClick={upload}>{progress>0&&progress<100?'Resume upload':hosted?'Upload selected video':'Upload to Cloudflare'}</button>:<small>Select a local video using Add video or Video setup.</small>}{busy&&<button className="ui-btn" onClick={()=>{stop.current=true;xhr.current?.abort()}}>Pause upload</button>}</div>}
 {(busy||progress>0)&&<><progress aria-label="Video upload progress" max="100" value={progress}/><span>{Math.floor(progress)}%</span></>}
 {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}{error&&file&&canUpload&&!busy&&<button className="ui-btn" onClick={()=>{try{localStorage.removeItem(storageKey)}catch{}setProgress(0);void upload()}}>Start a fresh upload</button>}
 {busy&&<small>Keep this tab open. Video goes directly to Cloudflare; no analysis job is started.</small>}
 </section>
}
