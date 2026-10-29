'use client'
import {useEffect,useState,type ReactNode} from 'react'
import {replayTime,type BroadcastCandidate,type BroadcastMatch} from '@/lib/scouting/broadcast-candidates'
import styles from './scout-live.module.css'
type Data={match:BroadcastMatch;candidates:BroadcastCandidate[];warnings:string[];coverage:string}
export default function BroadcastReview({matchId,videoId,ready,pending,duration,connect,seek,children,external=false}:{matchId:string;videoId:string;ready:boolean;pending:boolean;duration:number|null;connect:(id:string)=>void;seek:(seconds:number)=>boolean;children:ReactNode;external?:boolean}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(true)
 const [choice,setChoice]=useState('')
 const candidate=data?.candidates.find(c=>c.videoId===videoId)
 useEffect(()=>{if(external)return;const controller=new AbortController();setLoading(true);setError('');fetch(`/api/internal/scouting/${matchId}/broadcasts`,{signal:controller.signal,cache:'no-store'}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error);return body as Data}).then(body=>{setData(body);setChoice(body.candidates[0]?.videoId??'')}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[matchId,retry,external])
 const seconds=candidate?.suggestedOffset
 const valid=seconds!=null&&(!duration||seconds<duration)
 const locked=!ready||pending
 const recorded=data?.match.startedAt
 const timingHint=recorded?`Integration start: ${new Intl.DateTimeFormat('en-GB',{timeZone:data!.match.timezone,timeStyle:'medium'}).format(new Date(recorded))} (${data!.match.timezone}). Approximate replay position; start the first rally when ready.`:'Integration start unavailable.'
 if(external)return <>{children}</>
 return <><section className={styles.broadcastSources} aria-label="Match broadcast">
 {loading?<span className={styles.note} role="status">Finding broadcasts…</span>:<div className={styles.broadcastChoice}>
 <select className="ui-input" aria-label="Suggested broadcasts" value={choice} onChange={e=>setChoice(e.target.value)} disabled={!data?.candidates.length||pending}><option value="">Choose a broadcast</option>{data?.candidates.map(c=><option key={c.videoId} value={c.videoId}>{c.courtMatched?'Court match':'Check court'} · {c.title}</option>)}</select>
 <button className="ui-btn" data-variant="secondary" disabled={!choice||pending||choice===videoId} onClick={()=>connect(choice)}>Use broadcast</button>
 {valid&&<button className="ui-btn" data-variant="ghost" title={timingHint} disabled={locked} onClick={()=>seek(seconds!)}>Near start · {replayTime(seconds!)}</button>}
 </div>}
 {!loading&&!error&&!data?.candidates.length&&<p className={styles.note}>No suggestions. Use Video link to connect a replay.</p>}
 {data?.warnings.map(w=><p key={w} className={styles.note}>{w}</p>)}
 {error&&<p role="alert">{error} <button className="ui-btn" data-variant="secondary" onClick={()=>setRetry(x=>x+1)}>Retry discovery</button></p>}
 </section>{children}

 </>
}
