'use client'
import {useEffect,useId,useRef,useState} from 'react'
import {videoStatus,videoTitle,type VideoRun,type VideoFilter} from '@/lib/lab-vision/video-status'
import {Icon} from '@/components/IconSprite'
import './video-selector.css'

const filters:{id:VideoFilter;label:string}[]=[{id:'all',label:'All'},{id:'review',label:'Needs review'},{id:'ready',label:'Ready'},{id:'processing',label:'Processing'},{id:'failed',label:'Failed / stopped'}]
export default function VideoSelector({jobs,selectedId,onSelect,onAction}:{jobs:VideoRun[];selectedId:string;onSelect:(id:string)=>void;onAction:(id:string,tab:string)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[filter,setFilter]=useState<VideoFilter>('all')
 const panelId=useId(),trigger=useRef<HTMLButtonElement>(null),search=useRef<HTMLInputElement>(null)
 const selected=jobs.find(j=>j.id===selectedId)
 useEffect(()=>{if(open)search.current?.focus()},[open])
 const close=()=>{setOpen(false);trigger.current?.focus()}
 const visible=jobs.filter(j=>(filter==='all'||videoStatus(j).filter===filter)&&`${videoTitle(j)} ${j.file_name} ${j.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 const select=(id:string)=>{onSelect(id);close()}
 return <section className="lv-videos" aria-labelledby={`${panelId}-title`} onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();close()}}}>
  <div className="lv-videos-heading"><div><h3 id={`${panelId}-title`}>Training videos</h3><p>See what is analysed, what needs review, and what is ready.</p></div><small>Latest {jobs.length} analysis runs</small></div>
  <button ref={trigger} className="ui-btn lv-video-trigger" aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(v=>!v)}>
   <Icon id="video" className="lv-video-icon"/><span>{selected?videoTitle(selected):'Select an analysis run'}</span>{selected&&<span className="lv-video-status" data-status={videoStatus(selected).filter}>{videoStatus(selected).review}</span>}<span className="lv-video-toggle">{open?'Close':'Change video'}</span>
  </button>
  {open&&<div id={panelId} className="lv-video-panel">
   <label className="lv-video-search">Search videos or players<input ref={search} type="search" placeholder="Search videos or players…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <div className="lv-video-filters" role="group" aria-label="Filter videos by status">{filters.map(f=><button key={f.id} className="ui-btn" data-variant={filter===f.id?'primary':'default'} aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)}>{f.label} <span>{jobs.filter(j=>f.id==='all'||videoStatus(j).filter===f.id).length}</span></button>)}</div>
   <div className="lv-video-scroll"><table className="lv-video-table"><thead><tr><th scope="col">Video</th><th scope="col">Analysis</th><th scope="col">Label review</th><th scope="col">Next step</th></tr></thead><tbody>{visible.map(j=>{const status=videoStatus(j);return <tr key={j.id} data-selected={j.id===selectedId}>
    <td><button className="ui-btn lv-video-name" data-variant="ghost" aria-pressed={j.id===selectedId} onClick={()=>select(j.id)}>{videoTitle(j)}</button><small title={`${j.file_name} · Run ${j.id}`}>{j.file_name} · {new Date(j.updated_at).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})} · {j.id.slice(0,8)}{j.id===selectedId?' · Selected':''}</small></td>
    <td><span className="lv-video-status" data-status={j.status==='complete'?'ready':status.filter}>{status.analysis}</span></td>
    <td><span className="lv-video-status" data-status={status.filter}>{status.review}</span>{j.status==='complete'&&j.labels.total>0&&<><progress aria-label={`Saved labels reviewed for ${videoTitle(j)}`} max={j.labels.total} value={j.labels.reviewed}/><small>{j.labels.reviewed} / {j.labels.total} reviewed · {j.labels.eligible} eligible</small></>}</td>
    <td>{status.filter==='failed'?<a className="ui-btn" href={`/scouting/${encodeURIComponent(j.match_id)}/report?analysis=1`}>{status.action}</a>:<button className="ui-btn" data-variant={j.id===selectedId?'primary':'default'} onClick={()=>{onAction(j.id,status.tab);close()}}>{status.action}</button>}</td>
   </tr>})}</tbody></table></div>
   {!visible.length&&<p className="lv-video-empty" role="status">{jobs.length?'No videos match this search and status.':'No analysis runs yet. Add a video from a match report to start.'}{jobs.length>0&&<button className="ui-btn" onClick={()=>{setQuery('');setFilter('all')}}>Clear filters</button>}</p>}
   <footer><span aria-live="polite">{visible.length} of {jobs.length} runs · {jobs.filter(j=>videoStatus(j).filter==='ready').length} ready for training</span><span>Counts cover saved shot labels, not every shot in the video.</span></footer>
  </div>}
 </section>
}
