'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import type {Sample} from '@/lib/lab-vision/training'
import PlayerBox from './PlayerBox'
const clock=(s:number)=>`${Math.floor(s/60)}:${(s%60).toFixed(1).padStart(4,'0')}`
export default function PredictionMatch({evaluation,snapshot}:{evaluation:Sample;snapshot:Sample}){
 const rows=useMemo(()=>{const byId=new Map<string,Sample>(snapshot.samples.map((s:Sample)=>[s.id,s]));return evaluation.results.flatMap((r:Sample)=>{const sample=byId.get(r.annotationId);return sample?[{...r,sample}]:[]}).sort((a:Sample,b:Sample)=>a.sample.time-b.sample.time)},[evaluation,snapshot])
 const jobs=[...new Set<string>(rows.map((r:Sample)=>r.sample.jobId))]
 const [selectedJob,setSelectedJob]=useState(''),[source,setSource]=useState<{job:string;url:string}|null>(null),[error,setError]=useState(''),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[ready,setReady]=useState(false)
 const job=jobs.includes(selectedJob)?selectedJob:jobs[0],shots:Sample[]=rows.filter((r:Sample)=>r.sample.jobId===job),video=useRef<HTMLVideoElement>(null)
 const active=shots.filter(r=>time>=r.sample.start&&time<=r.sample.end).sort((a,b)=>Math.abs(a.sample.time-time)-Math.abs(b.sample.time-time))[0]
 const index=active?shots.indexOf(active):-1
 const url=source?.job===job?source.url:''
 useEffect(()=>{let alive=true;setSource(null);setError('');setReady(false);setPlaying(false);setTime(0);if(job)fetch(`/api/internal/lab-vision/workspace?job=${encodeURIComponent(job)}`,{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error('Could not load this match video.');if(alive)setSource({job,url:d.video.url})}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[job])
 async function play(){setError('');try{await video.current?.play()}catch{setError('Could not play the match. Try again.')}}
 function jump(r:Sample){const v=video.current;if(!v)return;v.pause();v.currentTime=r.sample.time;setTime(r.sample.time)}
 const next=shots.find(r=>r.sample.time>time+.05),previous=[...shots].reverse().find(r=>r.sample.time<time-.05)
 return <section className="lv-card lvt-section"><h3>Watch the model’s predictions</h3><p>Saved test predictions synchronized with the match. Green means the shot class matches your annotation; red means it differs. This is playback of evaluated results, not live inference.</p>
 {jobs.length>1&&<label>Match<select value={job} onChange={e=>setSelectedJob(e.target.value)}>{jobs.map(id=><option key={id} value={id}>{rows.find((r:Sample)=>r.sample.jobId===id).sample.fileName}</option>)}</select></label>}
 <div className="lvt-prediction-legend"><span data-correct="true">✓ Matches · {shots.filter(r=>r.correct).length}</span><span data-correct="false">✕ Differs · {shots.filter(r=>!r.correct).length}</span><span>Unlabelled moments: no evaluated prediction</span></div>
 {url?<div className="lv-video-frame lvt-match-video"><video key={job} ref={video} src={url} controls playsInline preload="metadata" aria-label="Match with saved shot predictions" onLoadedMetadata={e=>{e.currentTarget.currentTime=shots[0]?.sample.time??0;setTime(shots[0]?.sample.time??0);setReady(true)}} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onSeeked={e=>setTime(e.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>{setError('Source video could not be loaded.');setReady(false)}}/>
 <div className="lvt-match-flag" data-correct={active?String(active.correct):'none'}>{active?<><strong>{active.correct?'✓ MATCHES':'✕ DIFFERS'} · {active.predicted}</strong><span>Your label: {active.actual} · Confidence: {Math.round(active.confidence*100)}%</span><span>{active.sample.player}{active.sample.side&&active.sample.side!=='Unknown'?` · ${active.sample.side}`:''} · Contact {clock(active.sample.time)}</span></>:<><strong>No evaluated shot here</strong><span>Play on or jump to the next evaluated shot.</span></>}</div>
 {ready&&!playing&&active?.sample.box&&Math.abs(time-active.sample.time)<.04&&<PlayerBox box={active.sample.box} enabled={false} label={active.sample.player} sourceLabel="selected hitter" onChange={()=>{}}/>}
 </div>:<p role="status">{error||'Loading match video…'}</p>}
 <div className="lv-controls"><button className="ui-btn" data-variant="primary" disabled={!ready} onClick={()=>{if(playing)video.current?.pause();else void play()}}>{playing?'Pause match':'Play match'}</button><button className="ui-btn" disabled={!ready||!previous} onClick={()=>previous&&jump(previous)}>Previous shot</button><button className="ui-btn" disabled={!ready||!next} onClick={()=>next&&jump(next)}>Next shot</button><span>{active?`Shot ${index+1} of ${shots.length}`:`${shots.length} evaluated shots`}</span></div>
 {error&&url&&<p role="alert">{error}</p>}
 <p>{shots[0]?.sample.fileName} · Evaluated contacts from {shots.length?clock(shots[0].sample.time):'—'} to {shots.length?clock(shots.at(-1)!.sample.time):'—'}. Colour compares shot type only; forehand/backhand is the saved human label.</p>
 <details><summary>Jump to any evaluated shot</summary><div className="lvt-prediction-list">{shots.map((r,i)=><button className="ui-btn" key={r.annotationId} disabled={!ready} aria-label={`Shot ${i+1}, ${clock(r.sample.time)}, ${r.predicted}, ${r.correct?'matches':'differs'}`} onClick={()=>jump(r)}><span className="lvt-result-dot" data-correct={String(r.correct)}>{r.correct?'✓':'✕'}</span>{clock(r.sample.time)} · {r.predicted}</button>)}</div></details>
 </section>
}
