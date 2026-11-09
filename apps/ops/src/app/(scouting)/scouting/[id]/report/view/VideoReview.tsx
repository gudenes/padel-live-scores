'use client';
import {sharedReportEvent} from '@/lib/posthog/shared-report';
import {useEffect,useMemo,useState,useRef} from 'react';
import type {ReportView} from '@/lib/scouting/report-view';
import {parseTime,pointScore,replayPoints,timeLabel,videoSource,matchesRallyLength,replayRange} from '@/lib/scouting/video-review';
import {pointPlaybackWindows,playbackSavings,type PlayWindow} from '@/lib/scouting/continuous-points';
import ReplayPlayer from './ReplayPlayer';
import VideoUploadWizard from './VideoUploadWizard';
import {useAnalysisResult} from '@/lib/scouting/use-analysis-result';
import LocalAnalysis from './LocalAnalysis';
import type {VideoSetup} from '@/lib/scouting/video-setup';
import HostedVideoUpload,{type HostedVideo} from './HostedVideoUpload';
import LabVisionMiniature from './LabVisionMiniature';
import RedbullReviewPlayer from './RedbullReviewPlayer';
import ReviewNotes,{type ReviewContext} from './ReviewNotes';
import ReplayMomentum from './ReplayMomentum';
import MatchVideoTimeline from './MatchVideoTimeline';
import {momentLabelGroups,cleanMomentLabels} from '@/lib/scouting/moment-labels';
import {ArrowLeft,ArrowRight,CheckCircle} from './Icons';
import './video-review.css';
const outcomes:Record<string,string>={winner:'Winner',unforced:'Unforced error',forced:'Forced error committed',created:'Forced error created',double_fault:'Double fault',unclassified:'Unclassified'};
export default function VideoReview({data,scope,readOnly=false,initialPointId,reviewContext}:{data:ReportView;scope:string;readOnly?:boolean;initialPointId?:string|null;reviewContext?:ReviewContext}){
 const [uploadOpen,setUploadOpen]=useState(false);
 const [uploadFile,setUploadFile]=useState<File|null>(null);
 const [analysisSetup,setAnalysisSetup]=useState<VideoSetup|null>(null);
 const [hostedVideo,setHostedVideo]=useState<HostedVideo|null>(null);
 const published=useAnalysisResult(readOnly?undefined:reviewContext,hostedVideo?.id);
 const [courtTools,setCourtTools]=useState<HTMLDivElement|null>(null);
 const [videoStart,setVideoStart]=useState(0);
 const all=useMemo(()=>replayPoints(data.scopes.all.points,data.scopes.all.taps).map(p=>({...p,start:p.start===null?null:p.start-videoStart,end:p.end===null?null:p.end-videoStart})),[data,videoStart]);
 const initialPoint=all.find(p=>p.id===initialPointId)??all.find(p=>p.start!==null)??all[0];
 const key=(readOnly?'pn-shared-video-review:':'pn-video-review:')+all[0]?.id;
 const [filtersOpen,setFiltersOpen]=useState(true);
 const [outsideOnly,setOutsideOnly]=useState(false);
 const [url,setUrl]=useState(''),[draft,setDraft]=useState(''),[connecting,setConnecting]=useState(false),[error,setError]=useState('');
 const [localFile,setLocalFile]=useState<{url:string;name:string;size:number}|null>(null);
 const [localPilot,setLocalPilot]=useState(false);
 const [activityWindows,setActivityWindows]=useState<PlayWindow[]>([]);
 useEffect(()=>{if(!localPilot||!location.pathname.includes('53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa'))return;let active=true;fetch('/lab-vision/match1/activity-windows.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(active&&Array.isArray(d.windows)&&d.windows.length){setActivityWindows(d.windows)}}).catch(()=>{});return()=>{active=false}},[localPilot]);
 useEffect(()=>{setLocalPilot(true)},[]);
 useEffect(()=>()=>{if(localFile)URL.revokeObjectURL(localFile.url)},[localFile]);
 const source=useMemo(()=>localFile?{kind:'file' as const,id:localFile.url,url:localFile.url}:hostedVideo?{kind:'file' as const,id:hostedVideo.id,url:hostedVideo.url}:videoSource(url),[url,localFile,hostedVideo]);
 const playbackReady=!!source&&source.kind!=='redbull';
 const [player,setPlayer]=useState('all'),[outcome,setOutcome]=useState<string[]>([]),[shot,setShot]=useState<string[]>([]),[length,setLength]=useState('all'),[phase,setPhase]=useState('all'),[keyOnly,setKeyOnly]=useState(false);
 const [selected,setSelected]=useState(initialPoint?.id),[mode,setMode]=useState('full'),[command,setCommand]=useState({time:Math.max(0,(initialPoint?.start??0)-3),serial:initialPointId?1:0,play:true}),[clock,setClock]=useState(0),[duration,setDuration]=useState(0),[jump,setJump]=useState('');
 useEffect(()=>{if(readOnly){setUrl(data.videoUrl??'');return}try{const local=localStorage.getItem(key);const saved=local&&videoSource(local)?local:data.videoUrl;if(saved&&videoSource(saved)){setUrl(saved);setDraft(saved)}}catch{if(data.videoUrl){setUrl(data.videoUrl);setDraft(data.videoUrl)}}},[key,data.videoUrl,readOnly]);
 const filtered=all.filter(p=>(scope==='all'||String(p.before.sets.length)===scope)&&(!outsideOnly||!!p.outsideRecoveryBy?.length&&(player==='all'||p.outsideRecoveryBy.includes(Number(player) as 0|1|2|3)))&&(p.outcome==='forced'?(outcome.includes('forced')&&(player==='all'||outsideOnly||p.player===Number(player))||(!outcome.length||outcome.includes('created'))&&(player==='all'||outsideOnly||p.forcedBy===Number(player))&&(!outcome.includes('created')||p.forcedBy!=null)):(!outcome.length||outcome.includes(p.outcome))&&(player==='all'||outsideOnly||p.player===Number(player)))&&(!shot.length||!!p.shot&&shot.includes(p.shot))&&matchesRallyLength(p.touchCount,length)&&(!keyOnly||p.star||p.breakPoint!==null||p.setPoint.a||p.setPoint.b||p.matchPoint.a||p.matchPoint.b||p.before.phase==='tiebreak')&&(phase==='all'||player!=='all'&&(Math.floor(p.server/2)===Math.floor(Number(player)/2))===(phase==='serve')));
 const chosen=all.find(p=>p.id===selected),index=filtered.findIndex(p=>p.id===selected);
 const [savedMoments,setSavedMoments]=useState<{time:number;pointId:string;label:string;note?:string;labels?:string[];end?:number}[]>([]);
 const [momentsReady,setMomentsReady]=useState(false);
 useEffect(()=>{setMomentsReady(false);try{const value=JSON.parse(localStorage.getItem(key+':moments')||'[]');setSavedMoments(Array.isArray(value)?value.filter(m=>Number.isFinite(m.time)&&m.time>=0&&typeof m.pointId==='string'&&typeof m.label==='string').map(m=>({...m,labels:cleanMomentLabels(m.labels)})):[])}catch{setSavedMoments([])}setMomentsReady(true)},[key]);
 const momentDialog=useRef<HTMLDialogElement>(null);
 const [savedNotice,setSavedNotice]=useState(0);
 const [momentsOpen,setMomentsOpen]=useState(false);
 useEffect(()=>{if(!savedNotice)return;const timer=window.setTimeout(()=>setSavedNotice(0),3000);return()=>clearTimeout(timer)},[savedNotice]);
 const [momentDraft,setMomentDraft]=useState<{time:number;pointId:string;label:string}|null>(null);
 const [momentLabels,setMomentLabels]=useState<string[]>([]),[customLabel,setCustomLabel]=useState('');
 function addMomentLabel(){const next=cleanMomentLabels([...momentLabels,customLabel]);setMomentLabels(next);setCustomLabel('')}
 const [clipEnd,setClipEnd]=useState<number|null>(null);
 const [momentNote,setMomentNote]=useState(''),[momentError,setMomentError]=useState('');
 function openMoment(){if(!chosen||!playbackReady)return;seek(clock,false);const time=Math.floor(clock);setMomentDraft({time,pointId:chosen.id,label:`Point ${chosen.number} · Set ${chosen.before.sets.length}`});setMomentNote(savedMoments.find(m=>m.time===time)?.note??'');setMomentLabels(cleanMomentLabels(savedMoments.find(m=>m.time===time)?.labels));setCustomLabel('');setMomentError('');momentDialog.current?.showModal()}
 function saveMoment(e:React.FormEvent){e.preventDefault();if(!momentDraft)return;const moment={...momentDraft,note:momentNote.trim(),labels:cleanMomentLabels([...momentLabels,customLabel])};const next=[...savedMoments.filter(m=>m.time!==moment.time),moment].sort((a,b)=>a.time-b.time);try{localStorage.setItem(key+':moments',JSON.stringify(next));setSavedMoments(next);setError('');momentDialog.current?.close();setMomentsOpen(true);setSavedNotice(Date.now())}catch{setMomentError('Could not save this moment. Browser storage may be full.')}}

 const chosenKey=chosen&&(chosen.star||chosen.breakPoint!==null||chosen.setPoint.a||chosen.setPoint.b||chosen.matchPoint.a||chosen.matchPoint.b||chosen.before.phase==='tiebreak');

 const toggle=(values:string[],value:string)=>values.includes(value)?values.filter(v=>v!==value):[...values,value];
 const sets=[...new Set(all.map(p=>p.before.sets.length))];
 function seek(time:number,play=true){setClipEnd(null);if(readOnly)sharedReportEvent("shared_report_video_seek");setCommand(c=>({time:Math.max(0,time),serial:c.serial+1,play}));if(source?.kind!=='redbull')setClock(Math.max(0,time))}
 function choose(id:string){if(readOnly)sharedReportEvent("shared_report_replay_selected");const p=all.find(p=>p.id===id);setSelected(id);if(p?.start!==null&&p?.start!==undefined)seek(Math.max(0,p.start-3))}
 const range=replayRange(chosen?.start,chosen?.end,duration);
 const loop=mode==='loop'?range:null;
 const pointWindows=useMemo(()=>pointPlaybackWindows(all,duration),[all,duration]);
 const visionWindows=useMemo(()=>activityWindows.map(w=>({start:w.start+18881-videoStart,end:w.end+18881-videoStart})).filter(w=>w.end>0&&(duration<=0||w.start<duration)).map(w=>({start:Math.max(0,w.start),end:Math.min(duration>0?duration:Infinity,w.end)})),[activityWindows,videoStart,duration]);
 const skipWindows=activityWindows.length?visionWindows:pointWindows;
 const savings=useMemo(()=>playbackSavings(skipWindows,duration),[skipWindows,duration]);
 const shortDuration=(seconds:number)=>{const n=Math.round(seconds),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${h}h ${m}m ${s}s`:`${m}m ${s}s`};
 function connect(e:React.FormEvent){e.preventDefault();if(readOnly)return;const s=videoSource(draft);if(!s){setError('Use a Red Bull TV page, YouTube link or direct HTTPS MP4 / WebM video link.');return}setLocalFile(null);setVideoStart(0);setUrl(s.url);setDraft(s.url);setConnecting(false);setError('');setDuration(0);setMode('full');setCommand({time:0,serial:0,play:false});try{localStorage.setItem(key,s.url)}catch{}}
 return <section className="video-review" aria-label="Video review">
 <div className="vr-heading"><div className="vr-heading-main"><div><h2>Video review</h2><p>Find the point. Watch the context. Review it together.</p></div>{localPilot&&!readOnly&&<button className="ui-btn" data-variant="primary" onClick={()=>setUploadOpen(true)}>Add video</button>}{!readOnly&&<button className="ui-btn" onClick={()=>setConnecting(!connecting)}>{source?'Change video':'Connect video'}</button>}</div><button className="ui-btn vr-filter-toggle" data-variant={filtersOpen?'default':'primary'} aria-expanded={filtersOpen} aria-controls="review-filters" onClick={()=>setFiltersOpen(!filtersOpen)}><span aria-hidden="true">☷</span><span>{filtersOpen?'Hide filters':'Show filters'}{player!=='all'||outcome.length||shot.length||length!=='all'||phase!=='all'||keyOnly||outsideOnly?' · Active':''}</span><span aria-hidden="true">{filtersOpen?'›':'‹'}</span></button></div>
 {!readOnly&&(!source||connecting)&&<form className="vr-connect" onSubmit={connect}><label>Original match video<input className="ui-input" type="url" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Paste the original Red Bull TV, YouTube or direct video link" required/></label><button className="ui-btn" data-variant="primary">Connect video</button><p>Saved in this browser only. Use the original broadcast so the recorded times match.</p>{error&&<p role="alert">{error}</p>}</form>}
 {uploadOpen&&<VideoUploadWizard players={data.players.map(p=>p.name)} playerIds={data.players.map(p=>p.id)} initialOffset={location.pathname.includes('53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa')?18881:0} onClose={()=>setUploadOpen(false)} onComplete={(file,offset,setup)=>{setAnalysisSetup(setup);setUploadFile(file);setLocalFile({url:URL.createObjectURL(file),name:file.name,size:file.size});setVideoStart(offset);setDuration(0);setMode('full');setCommand({time:setup.matchStart,serial:Date.now(),play:false});setClock(setup.matchStart);setError('');setConnecting(false);setUploadOpen(false)}}/>}
 {localPilot&&!readOnly&&<details className="vr-video-setup"><summary>Video setup</summary><div className="vr-local-upload"><label className="ui-btn">Choose local video<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e=>{const file=e.target.files?.[0];if(!file)return;setUploadFile(file);setLocalFile({url:URL.createObjectURL(file),name:file.name,size:file.size});setVideoStart(location.pathname.includes("53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa")?18881:0);setDuration(0);setMode('full');setCommand({time:0,serial:0,play:false});setClock(0);setError('');setConnecting(false);e.target.value=''}}/></label><span>{localFile?.name??'Video stays on this computer'}</span>{localFile&&<label>Original broadcast time at video start <input className="ui-input" aria-label="Broadcast offset in seconds" type="number" min="0" step="0.1" value={videoStart} onChange={e=>setVideoStart(Math.max(0,Number(e.target.value)||0))}/><small>{timeLabel(videoStart)} · seconds; adjusts scouting timestamps only</small></label>}</div></details>}
 {!readOnly&&reviewContext&&<HostedVideoUpload context={reviewContext} file={uploadFile} offset={videoStart} duration={duration} onHosted={v=>{setHostedVideo(v);if(!localFile)setVideoStart(v.offset)}}/>}
 {!readOnly&&reviewContext&&hostedVideo&&<LocalAnalysis video={hostedVideo} setup={analysisSetup} onPrepare={()=>setUploadOpen(true)}/>}
 <div className={`vr-workspace${filtersOpen?'':' vr-filters-collapsed'}`}><div className="vr-main"><div className="vr-watch"><div className="vr-watch-video">

 {source?.kind==='redbull'?<RedbullReviewPlayer key={source.url} url={source.url} command={command}/>:source?<ReplayPlayer source={source} command={command} stopAt={clipEnd} loop={loop} playWindows={mode==='continuous'?skipWindows:undefined} onTime={(t,d)=>{setClock(t);setDuration(d);if(mode!=='loop'){const current=all.filter(p=>p.start!==null&&p.end!==null&&t>=Math.max(0,p.start-3)&&t<=p.end+3).sort((a,b)=>b.start!-a.start!)[0];if(current)setSelected(current.id)}}}/>:<div className="vr-empty"><h3>Bring this match to life</h3><p>{all.filter(p=>p.start!==null).length} points have video timestamps ready to replay.</p><p>Connect the original broadcast above to watch them here.</p></div>}

<div className="vr-media-point" aria-label="Point selection">
 <div className="vr-media-point-nav">
 <button className="ui-btn" aria-label="Previous matching point" disabled={index<=0} onClick={()=>choose(filtered[index-1].id)}><ArrowLeft/></button>
 <select aria-label="Select point to review" value={selected??''} onChange={e=>choose(e.target.value)}>
 {!chosen&&<option value="">Select a point</option>}
 {chosen&&index<0&&<option value={chosen.id}>Point {chosen.number} · Set {chosen.before.sets.length} · Outside filters</option>}
 {filtered.map(p=><option key={p.id} value={p.id}>Point {p.number} · Set {p.before.sets.length} · {outcomes[p.outcome]??p.outcome}</option>)}
 </select>
 <button className="ui-btn" aria-label="Next matching point" disabled={!filtered.length||index>=filtered.length-1} onClick={()=>choose(filtered[index+1].id)}><ArrowRight/></button>
 </div>
 {chosen&&<><span className="vr-media-point-score">{pointScore(chosen).split(' · ').slice(1).join(' · ')}</span>
 </>}
 <button className="ui-btn vr-save-moment-primary" data-variant="primary" disabled={!playbackReady||!chosen||!momentsReady} aria-label={savedNotice?'Moment saved':'Save moment'} aria-haspopup="dialog" onClick={openMoment}><span role="status" className="vr-save-label">{savedNotice?<><CheckCircle key={savedNotice} className="vr-save-check"/>Saved</>:<>☆ Save moment</>}</span></button><div className="vr-mode"><button className="ui-btn" data-variant={mode==='full'?'primary':'default'} aria-pressed={mode==='full'} onClick={()=>setMode('full')}>Full video</button><button className="ui-btn" data-variant={mode==='continuous'?'primary':'default'} aria-pressed={mode==='continuous'} disabled={!playbackReady||!skipWindows.length} title="Skip gaps using available match analysis. Beta: automatically selected sections may need review." onClick={()=>{setClipEnd(null);setMode('continuous')}}>Skip dead time <span className="vr-beta-badge">Beta</span></button><button className="ui-btn" data-variant={mode==='loop'?'primary':'default'} aria-pressed={mode==='loop'} disabled={!playbackReady||!range} onClick={()=>{setMode('loop');if(range)seek(range.start)}}>Rally loop</button></div>{mode==='continuous'&&savings&&<div className="vr-time-saved" role="status" title={`Estimated at normal speed: ${shortDuration(duration)} full video, ${shortDuration(savings.retained)} retained. Automatically selected sections may include replays.`}><span className="vr-savings-percent">−{savings.percent}%</span><span><strong>{shortDuration(savings.saved)} saved</strong><small>{shortDuration(savings.retained)} to review · estimated</small></span></div>}<details className="vr-media-more"><summary aria-label="More video tools" title="More video tools">•••</summary><div className="vr-coaching-bar vr-playback"><div className="vr-court-toolbar-host" ref={setCourtTools}/>{source&&<a href={source.url} target="_blank" rel="noreferrer">Open original video</a>}{chosen&&<details className="vr-media-point-details"><summary>Point details</summary><div>
 <strong>{chosen.player!==null?data.players[chosen.player].shortName:'Unclassified point'}</strong>
 <span>{outcomes[chosen.outcome]??chosen.outcome}{chosenKey?' · Key point':''}</span>
 <span>{chosen.shot?.replaceAll('_',' ')??'Shot not recorded'} · {chosen.touchCount} recorded hits</span>
 {chosen.outcome==='forced'&&<span>Created by: {chosen.forcedBy!=null?data.players[chosen.forcedBy].shortName:'Not recorded'}</span>}
 {!!chosen.outsideRecoveryBy?.length&&<span>Outside recovery: {chosen.outsideRecoveryBy.map(i=>data.players[i].shortName).join(', ')}</span>}
 {range&&<span>{timeLabel(range.start)} – {timeLabel(range.end)} · includes 3s before / after</span>}
 </div></details>}</div></details>
 </div>

{!readOnly&&published.result&&hostedVideo?.id===published.result.videoId&&(!localFile||(localFile.name===hostedVideo.name&&localFile.size===hostedVideo.size))?<LabVisionMiniature key={published.result.id+':'+(localFile?.url??hostedVideo.id)} result={published.result} clock={clock} onSeek={seek} toolbarHost={courtTools}/>:localPilot&&!hostedVideo&&localFile&&location.pathname.includes('53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa')&&<LabVisionMiniature key={localFile.url} clock={clock} onSeek={seek} toolbarHost={courtTools}/>}
</div></div><MatchVideoTimeline players={data.players} points={all} filtered={filtered} clock={clock} duration={duration} selected={selected} onChoose={choose} onSeek={t=>{setMode('full');seek(t)}} onScrub={t=>{setMode('full');seek(t,false)}} moments={savedMoments} enabled={playbackReady}/>{savedMoments.length>0&&<details open={momentsOpen} onToggle={e=>setMomentsOpen(e.currentTarget.open)} className="vr-saved-moments"><summary>Saved moments · {savedMoments.length}<small> · This browser</small></summary><div>{savedMoments.map(m=><button className="ui-btn" key={m.time} title={m.note?`${m.label} · ${m.note}`:m.label} onClick={()=>{setMode('full');setSelected(m.pointId);seek(m.time);setClipEnd(m.end??null)}}><span>{timeLabel(m.time)}{m.end?` – ${timeLabel(m.end)}`:''} · {m.label}</span>{!!m.labels?.length&&<span className="vr-saved-labels">{m.labels.map(label=><span key={label}>{label}</span>)}</span>}{m.note&&<small className="vr-moment-note">{m.note}</small>}</button>)}</div></details>}{error&&!connecting&&source&&<p role="alert">{error}</p>}<ReplayMomentum playerFiltered={player!=='all'} points={all} players={data.players} sets={data.sets} filtered={filtered} selected={selected} onChoose={choose}/></div><aside className="vr-sidebar" id="review-filters" hidden={!filtersOpen}> <div className="vr-chip-filters"><div className="vr-section-head"><h3>Quick filters</h3><small>{filtered.length} points</small></div>
 <div className="vr-chips" role="group" aria-label="Quick point filters"><button className="ui-btn" aria-pressed={keyOnly} data-variant={keyOnly?'primary':'default'} onClick={()=>setKeyOnly(!keyOnly)}>Key points</button><button className="ui-btn" aria-pressed={(length==='extended')} data-variant={(length==='extended')?'primary':'default'} onClick={()=>setLength((length==='extended')?'all':'extended')}>Long rallies · 10+ hits</button></div>
 <div className="vr-chip-row" role="group" aria-label="Attributed player"><b>Player</b><div className="vr-chips"><button className="ui-btn" aria-pressed={player==='all'} data-variant={player==='all'?'primary':'default'} onClick={()=>{setPlayer('all');setPhase('all')}}>All players</button>{data.players.map((p,i)=><button key={p.id} className="ui-btn vr-player-chip" aria-pressed={player===String(i)} data-variant={player===String(i)?'primary':'default'} onClick={()=>{setPlayer(player===String(i)?'all':String(i));if(player===String(i))setPhase('all')}}><span className="vr-player-key" data-team={i<2?'a':'b'} data-second={i%2===1}/><img src={p.avatar} alt=""/>{p.shortName}</button>)}</div></div>
 <div className="vr-chip-row" role="group" aria-label="Outcome"><b>Outcome</b><div className="vr-chips"><button className="ui-btn" aria-pressed={!outcome.length} data-variant={!outcome.length?'primary':'default'} onClick={()=>setOutcome([])}>All outcomes</button>{Object.entries(outcomes).map(([value,label])=><button key={value} className="ui-btn" aria-pressed={outcome.includes(value)} data-variant={outcome.includes(value)?'primary':'default'} onClick={()=>setOutcome(toggle(outcome,value))}>{label}</button>)}</div></div>
 <button className="ui-btn" aria-pressed={outsideOnly} data-variant={outsideOnly?'primary':'default'} onClick={()=>setOutsideOnly(!outsideOnly)}>Outside recovery attempts</button><details className="vr-more-filters"><summary>More filters{shot.length||length!=='all'||phase!=='all'||keyOnly||outsideOnly?' · Active':''}</summary><div className="vr-advanced">
 <div className="vr-chip-row" role="group" aria-label="Ending shot"><b>Ending shot</b><div className="vr-chips"><button className="ui-btn" aria-pressed={!shot.length} data-variant={!shot.length?'primary':'default'} onClick={()=>setShot([])}>All shots</button>{[...new Set(all.flatMap(p=>p.shot?[p.shot]:[]))].map(value=><button key={value} className="ui-btn" aria-pressed={shot.includes(value)} data-variant={shot.includes(value)?'primary':'default'} onClick={()=>setShot(toggle(shot,value))}>{value.replaceAll('_',' ')}</button>)}</div></div>
 <div className="vr-chip-row" role="group" aria-label="Rally length"><b>Rally length</b><div className="vr-chips">{[['all','Any length'],['short','1–3 hits'],['medium','4–6 hits'],['long','7–9 hits'],['extended','10+ hits'],['unknown','Not recorded']].map(([value,label])=><button key={value} className="ui-btn" aria-pressed={length===value} data-variant={length===value?'primary':'default'} onClick={()=>setLength(value)}>{label}</button>)}</div></div>
 <div className="vr-chip-row" role="group" aria-label="Point context"><b>Context</b><div className="vr-chips">{[['all','Serve & return'],['serve','Serving'],['return','Returning']].map(([value,label])=><button key={value} className="ui-btn" aria-pressed={phase===value} disabled={value!=='all'&&player==='all'} data-variant={phase===value?'primary':'default'} onClick={()=>setPhase(value)}>{label}</button>)}<button className="ui-btn" data-variant="ghost" onClick={()=>{setPlayer('all');setOutcome([]);setShot([]);setLength('all');setPhase('all');setKeyOnly(false);setOutsideOnly(false)}}>Clear filters</button></div></div>
 <p className="vr-filter-note">Rally length uses recorded taps, not a verified full shot count. Select a player to filter their pair’s serve or return. Outcome and shot chips allow multiple selections.</p>
 </div></details></div>
</aside></div>
 <section className="vr-rallies"><div className="vr-section-head"><h3>Matching rallies · {filtered.length}</h3><span>Choose any point to review</span></div>{!filtered.length?<p>No points match these filters. Try another player or outcome.</p>:<div className="vr-filmstrip">{filtered.map(p=><button className="ui-btn vr-rally" data-variant="ghost" aria-pressed={selected===p.id} onClick={()=>choose(p.id)} key={p.id}><div className="vr-rally-image">{p.player!==null&&<img loading="lazy" src={data.players[p.player].avatar} alt=""/>}<span>{p.start===null?'No timestamp':timeLabel(p.start)}</span></div><b>Point {p.number} · Set {p.before.sets.length}</b><span>{outcomes[p.outcome]??p.outcome}</span><small>{p.player!==null?data.players[p.player].shortName:'Unclassified'} · {p.before.currentGame.a}–{p.before.currentGame.b}</small></button>)}</div>}<p className="vr-note">Player portraits identify each rally. Video frame thumbnails are not available in the saved scouting.</p></section>

 <dialog ref={momentDialog} className="vr-moment-dialog" aria-labelledby="save-moment-title">
 <form onSubmit={saveMoment}>
 <h2 id="save-moment-title">Save this moment</h2>
 <p>{momentDraft?`${timeLabel(momentDraft.time)} · ${momentDraft.label}`:''}</p>
 <fieldset className="vr-moment-labels"><legend>Coaching labels <small>Choose several · {momentLabels.length}/12</small></legend>
 {momentLabelGroups.map(group=><div key={group.name}><h3>{group.name}</h3><div className="vr-label-options">{group.labels.map(label=><button type="button" className="ui-btn" key={label} aria-pressed={momentLabels.includes(label)} disabled={!momentLabels.includes(label)&&momentLabels.length>=12} data-variant={momentLabels.includes(label)?'primary':'default'} onClick={()=>setMomentLabels(current=>current.includes(label)?current.filter(v=>v!==label):cleanMomentLabels([...current,label]))}>{label}</button>)}</div></div>)}
 <label htmlFor="moment-custom-label">Your own label</label><div className="vr-custom-label"><input id="moment-custom-label" className="ui-input" maxLength={48} placeholder="e.g. Protect the backhand side" value={customLabel} onChange={e=>setCustomLabel(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addMomentLabel()}}}/><button type="button" className="ui-btn" disabled={!customLabel.trim()||momentLabels.length>=12} onClick={addMomentLabel}>Add label</button></div>
 {!!momentLabels.length&&<div className="vr-label-selected" aria-label="Selected coaching labels">{momentLabels.map(label=><button type="button" className="ui-btn" key={label} aria-label={`Remove label ${label}`} onClick={()=>setMomentLabels(current=>current.filter(v=>v!==label))}>{label} ×</button>)}</div>}
 </fieldset>
 <label htmlFor="moment-note">Note <span>(optional)</span></label>
 <textarea id="moment-note" className="ui-input" autoFocus rows={4} maxLength={1000} placeholder="What would you like to remember about this moment?" value={momentNote} onChange={e=>setMomentNote(e.target.value)}/>
 <small>Labels and notes are saved in this browser with your bookmarked moment.</small>
 {momentError&&<p role="alert">{momentError}</p>}
 <div className="vr-moment-actions"><button type="button" className="ui-btn" onClick={()=>momentDialog.current?.close()}>Cancel</button><button type="submit" className="ui-btn" data-variant="primary">Save moment</button></div>
 </form></dialog>
 {!readOnly&&reviewContext&&<ReviewNotes key={`${reviewContext.manual}:${reviewContext.matchId}:${reviewContext.userId}`} context={reviewContext} videoUrl={source?.url??''} clock={playbackReady?clock:null} onSeek={(nextUrl,time)=>{setUrl(nextUrl);setDraft(nextUrl);seek(time)}}/>}
 </section>
}
