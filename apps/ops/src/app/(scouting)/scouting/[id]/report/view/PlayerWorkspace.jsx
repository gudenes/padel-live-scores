'use client';
import Link from 'next/link';
import {playerProfileHref} from '@/lib/scouting/navigation';
import {useState,useCallback,useEffect,useRef} from 'react';
import ShotDistribution from './ShotDistribution';
import {shots} from '@/lib/scouting/shots';
import {endingFilters,shotDistribution} from '@/lib/scouting/shot-distribution';
import ReplayPlayer from './ReplayPlayer';
import './video-review.css';
import {videoSource,replayRange,pointScore,timeLabel} from '@/lib/scouting/video-review';
import {pointWeight} from '@/lib/scouting/methodology';
import './player-workspace.css';
export default function PlayerWorkspace({data,scope,playerIndex,onPlayer,onClose,readOnly=false,renderImpact}){
 const [selection,setSelection]=useState({outcome:'unforced',shot:null});
 const mini=useRef(null);
 const [review,setReview]=useState(null);
 const clock=useRef(0);
 const [noteDraft,setNoteDraft]=useState(null);
 const [note,setNote]=useState('');
 const [saveError,setSaveError]=useState('');
 const [saved,setSaved]=useState(false);
 const momentsKey=(readOnly?'pn-shared-video-review:':'pn-video-review:')+data.scopes.all.points[0]?.id+':moments';
 useEffect(()=>{if(!saved)return;const timer=setTimeout(()=>setSaved(false),3000);return()=>clearTimeout(timer)},[saved]);
 function startNote(){
  const time=Math.floor(clock.current);
  setNoteDraft({time,pointId:review.id,label:`Point ${review.number}`});setNote('');setSaveError('');setSaved(false);
  try{const moments=JSON.parse(localStorage.getItem(momentsKey)||'[]');if(Array.isArray(moments))setNote(moments.find(m=>m.time===time)?.note??'')}catch{}
 }
 function saveNote(e){
  e.preventDefault();if(!noteDraft)return;
  try{
   const moments=JSON.parse(localStorage.getItem(momentsKey)||'[]');
   if(!Array.isArray(moments))throw Error('Invalid saved moments');
   const next=[...moments.filter(m=>m.time!==noteDraft.time),{...noteDraft,note:note.trim()}].sort((a,b)=>a.time-b.time);
   localStorage.setItem(momentsKey,JSON.stringify(next));setNoteDraft(null);setSaved(true);
  }catch{setSaveError('Could not save this moment. Please check browser storage and try again.')}
 }
 const [source,setSource]=useState(null);
 const [duration,setDuration]=useState(0);
 const [repeat,setRepeat]=useState(true);
 const [command,setCommand]=useState({time:0,serial:0});
 function openReview(point){
  let url=data.videoUrl??'';
  if(!readOnly)try{const saved=localStorage.getItem('pn-video-review:'+data.scopes.all.points[0]?.id);if(saved&&videoSource(saved))url=saved}catch{}
  setSource(videoSource(url));setReview(point);setDuration(0);setNoteDraft(null);setSaved(false);
  const t=data.scopes[scope].taps.find(t=>t.id===point.id);
  clock.current=Math.max(0,(t?.start??0)-3);
  setCommand(current=>({time:clock.current,serial:mini.current?.open?current.serial+1:0}));
  if(!mini.current?.open)mini.current?.showModal();
 }
 const [metric,setMetric]=useState(null);
 const changed=useCallback((outcome,shot)=>{setSelection({outcome,shot});setMetric(null)},[]);
 useEffect(()=>setMetric(null),[playerIndex]);

 const d=data.scopes[scope],p=data.players[playerIndex],s=d.stats[playerIndex];
 const recoveredPoints=d.points.filter(point=>point.player===playerIndex&&point.outcome==='winner'&&(point.recovery||point.smashRecovery));
 const matching=d.points.filter(point=>{const r=shotDistribution([point],selection.outcome).rows[playerIndex];return r.total>0&&(!selection.shot||r.counts[selection.shot])});
 const metricKeys={'Key-point impact':'key','Winners':'winner','Unforced errors':'unforced','Forced errors':'forced','Created errors':'created','Assists':'assist','Balls recovered':'recovered'};
 const chartPoints=metric?d.points.filter(point=>{
  if(metric==='recovered')return recoveredPoints.includes(point);
  if(metric==='key')return pointWeight(point)>1;
  if(metric==='smashRecovered')return point.recoveredSmashBy===playerIndex;
  if(metric==='smashWinner')return point.player===playerIndex&&point.outcome==='winner'&&point.smash;
  if(metric==='assist')return point.outcome==='winner'&&point.assistBy===playerIndex&&point.player===(playerIndex^1)&&Math.floor(point.player/2)===(point.winner==='a'?0:1);
  return shotDistribution([point],metric).rows[playerIndex].total>0;
 }):matching;
 const chartLabel=metric==='recovered'?'Balls recovered · recovery winners':metric==='smashRecovered'?'Recovered by rival':metric==='smashWinner'?'Smash winners':metric==='key'?'Key points':metric==='assist'?'Assists':endingFilters[metric??selection.outcome];
 const markerTypes=Object.fromEntries(chartPoints.map(point=>{
  const kind=metric??selection.outcome;
  const type=kind==='assist'?'assist':point.outcome==='forced'&&point.forcedBy===playerIndex?'created':point.outcome;
  return [point.number,type];
 }));
 const timing=new Map(d.taps.map(r=>[r.id,r]));
 const replayable=d.points.filter(point=>{const t=timing.get(point.id);return t?.start!=null&&t?.end!=null&&t.end>t.start});
 const reviewIndex=replayable.findIndex(point=>point.id===review?.id);

 return <section className="panel player-workspace" aria-label={`${p.name} analysis`}>
  <nav className="pw-switcher" aria-label="Analyze a player"><button className="ui-btn" data-variant="ghost" onClick={onClose}>← All players</button>{data.players.map((player,i)=><button className="ui-btn" data-variant={i===playerIndex?'primary':'ghost'} aria-pressed={i===playerIndex} key={player.id} onClick={()=>onPlayer(i)}><img src={player.avatar} alt=""/>{player.shortName}</button>)}</nav>
  <div className="pw-summary"><div className="pw-identity"><img src={p.avatar} alt=""/><div><h2>{p.name}</h2>{!readOnly&&playerProfileHref([p.profileId!==undefined?p.profileId:p.id])&&<Link className="profileConnection" href={playerProfileHref([p.profileId!==undefined?p.profileId:p.id])}>View full profile ↗</Link>}<small>{scope==='all'?'Full match':`Set ${scope}`} · Player analysis</small></div></div>{[['Player score',d.analysis.players[playerIndex].score?.toFixed(1)??'—'],['Key-point impact',d.keyPointAnalysis?.observedPoints?d.keyPointAnalysis.players[playerIndex].impact.toFixed(2):'—'],['Winners',s.winners],['Unforced errors',s.unforced],['Forced errors',s.forced],['Created errors',s.forcedErrorsCreated],['Assists',s.assists],['Balls recovered',recoveredPoints.length]].map(([name,value])=>metricKeys[name]?<button type="button" className="ui-btn pw-stat pw-stat-action" data-variant={metric===metricKeys[name]?'primary':'default'} aria-pressed={metric===metricKeys[name]} title={name==='Balls recovered'?'Recovery winners, including smash recoveries. Each point counted once.':undefined} aria-label={`Highlight ${name.toLowerCase()} on the impact chart`} key={name} onClick={()=>setMetric(current=>current===metricKeys[name]?null:metricKeys[name])}><small>{name}</small><strong>{value}</strong><span className="pw-stat-hint">{metric===metricKeys[name]?'Highlighted ✓':'Show on chart ↗'}</span></button>:<div className="pw-stat" key={name}><small>{name}</small><strong>{value}</strong></div>)}</div>
  <section className="pw-smash-summary" aria-label="Smash effectiveness">
   <div className="pw-smash-intro"><h3>Smash effectiveness</h3><small>{scope==='all'?'Full match':`Set ${scope}`}</small></div>
   <div className="pw-stat"><small>Smash attempts</small><strong>{s.smashes??0}</strong></div>
   <button type="button" className="ui-btn pw-stat pw-stat-action" data-variant={metric==='smashWinner'?'primary':'default'} aria-pressed={metric==='smashWinner'} aria-label="Highlight smash winners on the impact chart" onClick={()=>setMetric(current=>current==='smashWinner'?null:'smashWinner')}><small>Smash winners</small><strong>{s.smashWinners??0}</strong><span className="pw-stat-hint">{metric==='smashWinner'?'Highlighted ✓':'Show on chart ↗'}</span></button>
   <button type="button" className="ui-btn pw-stat pw-stat-action" data-variant={metric==='smashRecovered'?'primary':'default'} aria-pressed={metric==='smashRecovered'} aria-label="Highlight smashes recovered by rival on the impact chart" onClick={()=>setMetric(current=>current==='smashRecovered'?null:'smashRecovered')}><small>Recovered by rival</small><strong>{s.smashRecoveredByRival??0}</strong><span className="pw-stat-hint">{metric==='smashRecovered'?'Highlighted ✓':'Show on chart ↗'}</span></button>
   <div className="pw-stat"><small>Winner conversion</small><strong>{s.smashes>0?`${Math.round((s.smashWinners??0)/s.smashes*100)}%`:'—'}</strong></div>
   <p className="pw-smash-note">{s.smashes>0?`${s.smashWinners??0} of ${s.smashes} recorded attempts ended in a direct smash winner.`:'No smash attempts recorded in this selection.'} Rival recoveries count recovery winners with an identifiable smasher; ambiguous older points are excluded.</p>
  </section>
  <div className="pw-charts"><section className="pw-impact"><h3>Cumulative weighted impact</h3><p className="muted">All four players · {p.shortName} highlighted. Solid and dotted lines distinguish teammates.</p><p className="pw-marker-caption" aria-live="polite">{chartPoints.length} marked points · {chartLabel}{!metric&&selection.shot?` · ${shots[selection.shot]??'Not recorded'}`: ''}. Shapes identify point outcomes. Hover to inspect.</p>{d.points.length?renderImpact(playerIndex,chartPoints.map(point=>point.number),chartLabel,markerTypes,openReview,point=>{const t=timing.get(point.id);return t?.start!=null&&t?.end!=null&&t.end>t.start}):<p>No observed points in this set.</p>}<div className="pw-outcome-legend" aria-label="Point marker shapes">{[['●','Winning contributions','winner'],['×','Unforced mistakes','unforced'],['■','Forced errors committed','forced']].map(([shape,label,kind])=><span key={kind}><b data-outcome={kind} aria-hidden="true">{shape}</b>{label}</span>)}</div></section><ShotDistribution key={playerIndex} data={data} scope={scope} focusPlayer={playerIndex} onSelectionChange={changed}/></div>
  <dialog ref={mini} className="pw-mini-replay" aria-labelledby="mini-replay-title" onClose={()=>setReview(null)}>
   {review&&<><header className="pw-branded-header"><div className="pw-replay-heading"><span className="pw-replay-eyebrow">MATCH REVIEW</span><h3 id="mini-replay-title">Match situation <span>Point {review.number}</span></h3><small>{pointScore(review)}</small></div><div className="pw-replay-nav"><button type="button" className="ui-btn" aria-label="Previous point" title="Previous point with video" disabled={reviewIndex<=0||!!noteDraft} onClick={()=>openReview(replayable[reviewIndex-1])}>←</button><button type="button" className="ui-btn" aria-label="Next point" title="Next point with video" disabled={reviewIndex<0||reviewIndex>=replayable.length-1||!!noteDraft} onClick={()=>openReview(replayable[reviewIndex+1])}>→</button><button type="button" className="ui-btn pw-replay-close" aria-label="Close replay" onClick={()=>mini.current?.close()}>✕</button></div></header>
   <div className="pw-replay-classification">
    {review.player!=null&&data.players[review.player]&&<img src={data.players[review.player].avatar} alt="" style={{borderColor:review.player<2?'#c8f52b':'#ff8179'}}/>}
    <div><strong>{review.player!=null?data.players[review.player]?.shortName??'Unknown player':'Player not recorded'}</strong><small>{shots[review.shot]??(review.outcome==='double_fault'?'Serve':'Shot not recorded')}</small></div>
    <span className="pw-outcome-badge" data-error={['unforced','forced','double_fault'].includes(review.outcome)}>{({winner:'Winner',unforced:'Unforced error',forced:'Forced error committed',double_fault:'Double fault',unclassified:'Unclassified'})[review.outcome]??'Unclassified'}</span>
    {pointWeight(review)>1&&<span className="pw-key-badge">★ Key point</span>}
    {review.outcome==='forced'&&review.forcedBy!=null&&<small className="pw-replay-credit">Forced error created by {data.players[review.forcedBy]?.shortName}</small>}
   </div>
   {source?<><ReplayPlayer source={source} command={command} loop={repeat?replayRange(timing.get(review.id)?.start,timing.get(review.id)?.end,duration):null} onTime={(t,d)=>{clock.current=t;setDuration(d)}}/><footer><button className="ui-btn pw-save-moment" onClick={startNote}><span className={saved?"pw-saved-check":""} aria-hidden="true">{saved?"✓":"☆"}</span> {saved?"Saved":"Save moment"}</button><button className="ui-btn" aria-pressed={repeat} data-variant={repeat?'primary':'default'} onClick={()=>setRepeat(!repeat)}>Repeat point</button><button className="ui-btn" onClick={()=>setCommand(c=>({time:Math.max(0,(timing.get(review.id)?.start??0)-3),serial:c.serial+1}))}>Replay from start</button><small>Includes 3 seconds before and after.</small></footer>{saved&&<small role="status">Saved in Video review → Saved moments · This browser.</small>}
   {noteDraft&&<form className="pw-note-form" onSubmit={saveNote}><label htmlFor="mini-moment-note">Note <small>(optional) · {timeLabel(noteDraft.time)}</small></label><textarea id="mini-moment-note" className="ui-input" autoFocus rows={3} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder="What would you like to remember about this moment?"/><small>Saved in this browser with your bookmarked moment.</small>{saveError&&<p role="alert">{saveError}</p>}<div><button type="button" className="ui-btn" onClick={()=>setNoteDraft(null)}>Cancel</button><button type="submit" className="ui-btn" data-variant="primary">Save moment</button></div></form>}</>:<p>No video connected for this report. Connect the match video in Video review first.</p>}</>}
  </dialog>
 </section>
}
