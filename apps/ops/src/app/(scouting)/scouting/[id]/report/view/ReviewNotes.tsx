"use client";
import {useEffect,useRef,useState} from 'react'
import {parseTime,timeLabel} from '@/lib/scouting/video-review'
import {reviewTags,type ReviewTag,type ReviewNote} from '@/lib/scouting/review-notes'
import './review-notes.css'
export type ReviewContext={matchId:string;manual:boolean;userId:string}
export default function ReviewNotes({context,videoUrl,clock,onSeek}:{context:ReviewContext;videoUrl:string;clock:number;onSeek:(url:string,time:number)=>void}){
 const endpoint=`/api/internal/scouting-review-notes/${context.matchId}?kind=${context.manual?'manual':'canonical'}`
 const [notes,setNotes]=useState<ReviewNote[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0)
 const [note,setNote]=useState(''),[tag,setTag]=useState<ReviewTag>('note'),[stamp,setStamp]=useState('')
 const pending=useRef<{payload:string;id:string}|null>(null)
 useEffect(()=>{const controller=new AbortController();fetch(endpoint,{cache:'no-store',signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load notes.');if(!controller.signal.aborted)setNotes(d.notes)}).catch(e=>{if(e.name!=='AbortError')setLoadError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[endpoint,retry])
 async function save(e:React.FormEvent){
  e.preventDefault();setError('');setNotice('')
  const seconds=stamp.trim()?parseTime(stamp.trim()):null
  if(stamp.trim()&&(seconds===null||seconds>86400||!videoUrl)){setError('Connect a video and enter a timestamp as mm:ss or hh:mm:ss.');return}
  const payload=JSON.stringify({videoUrl:stamp.trim()?videoUrl:'',seconds,tag,note:note.trim()})
  if(!pending.current||pending.current.payload!==payload)pending.current={payload,id:crypto.randomUUID()}
  setBusy(true)
  try{
   const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(payload),id:pending.current.id})});const d=await r.json()
   if(!r.ok)throw Error(d.error||'Could not save the note.')
   setNotes(old=>[...old.filter(n=>n.id!==d.note.id),d.note]);setNote('');setStamp('');pending.current=null;setNotice('Review note saved for the team.')
  }catch(e){setError(e instanceof Error?e.message:'Could not save. Your draft is retained.')}finally{setBusy(false)}
 }
 async function remove(id:string){setBusy(true);setError('');setNotice('');try{const r=await fetch(endpoint+'&noteId='+id,{method:'DELETE'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not remove note.');setNotes(old=>old.filter(n=>n.id!==id));setNotice('Review note removed.')}catch(e){setError(e instanceof Error?e.message:'Could not remove note.')}finally{setBusy(false)}}
 return <section className="review-notes ui-panel" aria-label="Team review notes">
 <h3>Team review notes</h3><p>Tag a video moment or leave a match note for the team. Review notes do not change scouting data, scores or statistics.</p>
 <form onSubmit={save}><fieldset disabled={busy||loading}><div className="review-note-fields">
 <label>Tag<select className="ui-input" value={tag} onChange={e=>setTag(e.target.value as ReviewTag)}>{Object.entries(reviewTags).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
 <label>Video timestamp (optional)<input className="ui-input" value={stamp} onChange={e=>setStamp(e.target.value)} placeholder="mm:ss or hh:mm:ss"/></label>
 <button className="ui-btn" type="button" disabled={!videoUrl} onClick={()=>setStamp(timeLabel(clock))}>Use current time</button></div>
 <label>Review note<textarea className="ui-input" required maxLength={2000} rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="What should the team review?"/></label>
 <button className="ui-btn" data-variant="primary" type="submit" disabled={!note.trim()}>{busy?'Saving…':'Save review note'}</button></fieldset></form>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {loading?<p role="status">Loading team notes…</p>:loadError?<p role="alert">{loadError} <button className="ui-btn" onClick={()=>{setLoading(true);setLoadError('');setRetry(n=>n+1)}}>Retry</button></p>:!notes.length?<p>No team review notes yet.</p>:<ol className="review-note-list">{notes.map(n=><li key={n.id}><div className="review-note-meta"><strong>{reviewTags[n.tag]}</strong><span>{n.author_name} · {new Date(n.created_at).toLocaleString()}</span>{n.video_seconds!==null&&<button type="button" className="ui-btn" onClick={()=>onSeek(n.video_url,n.video_seconds!)}>Play {timeLabel(n.video_seconds)}</button>}</div><p className="review-note-body">{n.note}</p>{n.author_user_id===context.userId&&<button type="button" className="ui-btn" data-variant="ghost" disabled={busy} onClick={()=>void remove(n.id)}>Remove my note</button>}</li>)}</ol>}
 </section>
}
