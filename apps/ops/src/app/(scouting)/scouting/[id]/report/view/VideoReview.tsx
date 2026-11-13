'use client';
import {scoutToVideo,videoToScout} from '@/lib/scouting/scouting-alignment';
import {selectReviewSource,reviewSourceOffset} from '@/lib/scouting/review-source';
import {sharedReportEvent} from '@/lib/posthog/shared-report';
import {useEffect,useMemo,useState,useRef} from 'react';
import type {ReportView} from '@/lib/scouting/report-view';
import {parseTime,pointScore,replayPoints,timeLabel,videoSource,matchesRallyLength,replayRange} from '@/lib/scouting/video-review';
import {pointPlaybackWindows,playbackSavings,type PlayWindow} from '@/lib/scouting/continuous-points';
import ReplayPlayer from './ReplayPlayer';
import {VideoMovement} from './MovementCharts';
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
export default function VideoReview({data,scope,readOnly=false,initialPointId,reviewContext,movementTime,movementPlayer}:{data:ReportView;scope:string;readOnly?:boolean;initialPointId?:string|null;reviewContext?:ReviewContext;movementTime?:number|null;movementPlayer?:string|null}){
 const [analysisOpen,setAnalysisOpen]=useState(false);
 useEffect(()=>{if(new URLSearchParams(location.search).get('analysis')==='1')setAnalysisOpen(true)},[]);
 const [uploadStatus,setUploadStatus]=useState('Video & analysis');
 const [analysisStatus,setAnalysisStatus]=useState('');
 const analysisPill=uploadStatus.startsWith('Uploading')||uploadStatus.startsWith('Verifying')||uploadStatus==='Upload needs attention'?uploadStatus:analysisStatus||uploadStatus;
 const [uploadOpen,setUploadOpen]=useState(false);
 const [uploadFile,setUploadFile]=useState<File|null>(null);
 const [analysisSetup,setAnalysisSetup]=useState<VideoSetup|null>(null);
 const [hostedVideo,setHostedVideo]=useState<HostedVideo|null>(null);
 const published=useAnalysisResult(readOnly?undefined:reviewContext,hostedVideo?.id);
 const [courtTools,setCourtTools]=useState<HTMLDivElement|null>(null);
 const [videoStart,setVideoStart]=useState(0);
 const [url,setUrl]=useState(''),[draft,setDraft]=useState(''),[connecting,setConnecting]=useState(false),[error,setError]=useState('');
 const [localFile,setLocalFile]=useState<{url:string;name:string;size:number}|null>(null);
 const [sourceChoice,setSourceChoice]=useState<'auto'|'broadcast'|'uploaded'|'local'>('auto');
 const broadcast=useMemo(()=>videoSource(url),[url]);
 const activeSource=selectReviewSource(sourceChoice,{broadcast:!!broadcast,uploaded:!!hostedVideo,local:!!localFile});
 const source=useMemo(()=>activeSource==='local'&&localFile?{kind:'file' as const,id:localFile.url,url:localFile.url}:activeSource==='uploaded'&&hostedVideo?{kind:'file' as const,id:hostedVideo.id,url:hostedVideo.url}:broadcast,[activeSource,broadcast,localFile,hostedVideo]);
 const analysisPlayback=activeSource==='uploaded'||activeSource==='local'&&!!hostedVideo&&localFile?.name===hostedVideo.name&&localFile?.size===hostedVideo.size;
 const rawPoints=useMemo(()=>replayPoints(data.scopes.all.points,data.scopes.all.taps),[data]);
 const firstRecorded=rawPoints.find(p=>p.start!==null)?.start??null;
 const liveClock=firstRecorded!==null&&firstRecorded>100000000;
 const alignmentKey=`pn-broadcast-alignment:${reviewContext?.matchId??rawPoints[0]?.id}:${url}`;
 const [broadcastOffset,setBroadcastOffset]=useState<number|null>(null),[anchorText,setAnchorText]=useState('');
 const [alignmentStatus,setAlignmentStatus]=useState(''),[alignmentBusy,setAlignmentBusy]=useState(false),[canAlign,setCanAlign]=useState(false);
 const alignmentApi=reviewContext?`/api/internal/match-replay-alignment/${reviewContext.matchId}?kind=${reviewContext.manual?'manual':'canonical'}`:null;
 useEffect(()=>{let active=true;setBroadcastOffset(null);setAnchorText('');setCanAlign(false);setAlignmentStatus('');
  if(readOnly&&data.replayAlignment){setBroadcastOffset(data.replayAlignment.recorded_seconds-data.replayAlignment.replay_seconds);setAlignmentStatus('Saved for everyone viewing this match.');return;}
  if(!alignmentApi||!broadcast)return;
  fetch(`${alignmentApi}&url=${encodeURIComponent(broadcast.url)}`).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!active)return;setCanAlign(d.canEdit);if(d.alignment){setBroadcastOffset(d.alignment.recorded_seconds-d.alignment.replay_seconds);setAnchorText(new Date(d.alignment.replay_seconds*1000).toISOString().slice(11,19));setAlignmentStatus('Saved for everyone viewing this match.')}else{try{const value=JSON.parse(localStorage.getItem(alignmentKey)||'null');if(value&&Number.isFinite(value.offset)){setBroadcastOffset(value.offset);setAnchorText(value.time);setAlignmentStatus('Local alignment only. Save it to the match to share it.')}}catch{}}}).catch(e=>{if(active)setAlignmentStatus(e.message)});return()=>{active=false};
 },[alignmentApi,broadcast,alignmentKey,readOnly,data.replayAlignment]);
 async function saveAlignment(){const t=parseTime(anchorText);if(t===null||firstRecorded===null||!alignmentApi||!broadcast)return;setAlignmentBusy(true);setAlignmentStatus('Saving alignment…');try{const r=await fetch(alignmentApi,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoUrl:broadcast.url,recordedSeconds:firstRecorded,replaySeconds:t})});const d=await r.json();if(!r.ok)throw Error(d.error);setBroadcastOffset(d.alignment.recorded_seconds-d.alignment.replay_seconds);setAlignmentStatus('Saved for everyone viewing this match.');setClock(t);setDuration(0);setCommand(c=>({time:Math.max(0,t-3),serial:c.serial+1,play:false}));}catch(e){setAlignmentStatus(e instanceof Error?e.message:'Could not save alignment.')}finally{setAlignmentBusy(false)}}
 const needsBroadcastAlignment=activeSource==='broadcast'&&liveClock&&broadcastOffset===null;
 const scoutingOffset=activeSource==='broadcast'?(broadcastOffset??0):reviewSourceOffset(activeSource,videoStart,hostedVideo?.offset??0,analysisPlayback?published.result?.manifest.scoutingAlignment?.offsetSeconds:undefined);
 const scoutingAlignment=analysisPlayback?published.result?.manifest.scoutingAlignment:undefined;
 const all=useMemo(()=>rawPoints.map(p=>({...p,start:needsBroadcastAlignment||p.start===null?null:scoutToVideo(p.start,scoutingOffset,scoutingAlignment),end:needsBroadcastAlignment||p.end===null?null:scoutToVideo(p.end,scoutingOffset,scoutingAlignment)})),[rawPoints,scoutingOffset,scoutingAlignment,needsBroadcastAlignment]);
 const initialPoint=all.find(p=>p.id===initialPointId)??all.find(p=>p.start!==null)??all[0];
 const key=(readOnly?'pn-shared-video-review:':'pn-video-review:')+all[0]?.id;
 const [filtersOpen,setFiltersOpen]=useState(true);
 const [outsideOnly,setOutsideOnly]=useState(false);
 const [localPilot,setLocalPilot]=useState(false);
 const [activityWindows,setActivityWindows]=useState<PlayWindow[]>([]);
 useEffect(()=>{if(!localPilot||!location.pathname.includes('53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa'))return;let active=true;fetch('/lab-vision/match1/activity-windows.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(active&&Array.isArray(d.windows)&&d.windows.length){setActivityWindows(d.windows)}}).catch(()=>{});return()=>{active=false}},[localPilot]);
 useEffect(()=>{setLocalPilot(true)},[]);
 useEffect(()=>()=>{if(localFile)URL.revokeObjectURL(localFile.url)},[localFile]);
 const playbackReady=!!source&&source.kind!=='redbull';
 const [player,setPlayer]=useState('all'),[outcome,setOutcome]=useState<string[]>([]),[shot,setShot]=useState<string[]>([]),[length,setLength]=useState('all'),[phase,setPhase]=useState('all'),[keyOnly,setKeyOnly]=useState(false);
 const [selected,setSelected]=useState(initialPoint?.id),[mode,setMode]=useState('full'),[command,setCommand]=useState({time:0,serial:initialPointId?1:0,play:true}),[clock,setClock]=useState(0),[duration,setDuration]=useState(0),[jump,setJump]=useState('');
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
 function seek(time:number,play=true){setClipEnd(null);if(readOnly)sharedReportEvent("shared_report_video_seek");setCommand(c=>({time:Math.max(0,time),serial:c.serial+1,play}));setClock(Math.max(0,time))}
 function choose(id:string){if(readOnly)sharedReportEvent("shared_report_replay_selected");const p=all.find(p=>p.id===id);setSelected(id);if(p?.start!==null&&p?.start!==undefined&&(!duration||p.start<duration))seek(Math.max(0,p.start-3))}
 useEffect(()=>{
  if(sourceChoice!=='auto'||!source||needsBroadcastAlignment)return;
  const time=Math.max(0,analysisPlayback&&movementTime!=null?movementTime:(all.find(p=>p.id===selected)?.start??0)-3);
  setDuration(0);setClock(time);setMode('full');setCommand(c=>({time,serial:c.serial+1,play:false}));
 // Reset clocks when the ready hosted source replaces the broadcast.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[activeSource,source?.id]);
 const range=replayRange(chosen?.start,chosen?.end,duration);
 const loop=mode==='loop'?range:null;
 const pointWindows=useMemo(()=>pointPlaybackWindows(all,duration),[all,duration]);
 const visionWindows=useMemo(()=>activityWindows.map(w=>({start:w.start+18881-videoStart,end:w.end+18881-videoStart})).filter(w=>w.end>0&&(duration<=0||w.start<duration)).map(w=>({start:Math.max(0,w.start),end:Math.min(duration>0?duration:Infinity,w.end)})),[activityWindows,videoStart,duration]);
 const detectedActivity=analysisPlayback?published.result?.manifest.activity:undefined;
 const activeWindows=detectedActivity?detectedActivity.windows:activeSource==='local'?visionWindows:[];
 // A partial analysis must not skip unprocessed footage outside its source window.
 const skipWindows=detectedActivity? (published.result!.manifest.partial?[]:activeWindows):activeSource==='local'&&activityWindows.length?visionWindows:pointWindows;
 const savings=useMemo(()=>playbackSavings(skipWindows,duration),[skipWindows,duration]);
 const shortDuration=(seconds:number)=>{const n=Math.round(seconds),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${h}h ${m}m ${s}s`:`${m}m ${s}s`};
 function connect(e:React.FormEvent){e.preventDefault();if(readOnly)return;const s=videoSource(draft);if(!s){setError('Use a Red Bull TV page, YouTube link or direct HTTPS MP4 / WebM video link.');return}setSourceChoice('broadcast');setUrl(s.url);setDraft(s.url);setConnecting(false);setError('');setDuration(0);setMode('full');setCommand({time:0,serial:0,play:false});try{localStorage.setItem(key,s.url)}catch{}}

 function switchSource(next:'broadcast'|'uploaded'|'local'){
  const originalTime=videoToScout(clock,scoutingOffset,scoutingAlignment);
  const nextOffset=next==='broadcast'?(broadcastOffset??0):next==='uploaded'?(published.result?.manifest.scoutingAlignment?.offsetSeconds??hostedVideo?.offset??0):videoStart;
  const sameLocal=next==='local'&&!!hostedVideo&&localFile?.name===hostedVideo.name&&localFile?.size===hostedVideo.size;
  const nextAlignment=next==='uploaded'||sameLocal?published.result?.manifest.scoutingAlignment:undefined;
  const time=Math.max(0,scoutToVideo(originalTime,nextOffset,nextAlignment));
  setSourceChoice(next);setDuration(0);setMode('full');setClipEnd(null);setClock(time);setCommand(c=>({time,serial:c.serial+1,play:false}));
 }
 return <section className="video-review" aria-label="Video review">
 <div className="vr-heading"><div className="vr-heading-main"><div><h2>Video review</h2><p>Find the point. Watch the context. Review it together.</p></div>{localPilot&&!readOnly&&!source&&<button className="ui-btn" data-variant="primary" onClick={()=>setUploadOpen(true)}>Add video</button>}{!readOnly&&<button className="ui-btn va-status-button" title="Video & analysis" aria-label={`Video & analysis: ${analysisPill}`} aria-controls="video-analysis-drawer" aria-expanded={analysisOpen} onClick={()=>setAnalysisOpen(!analysisOpen)}>{analysisPill}</button>}</div><button className="ui-btn vr-filter-toggle" data-variant={filtersOpen?'default':'primary'} aria-expanded={filtersOpen&&!analysisOpen} aria-controls="review-filters" onClick={()=>{setAnalysisOpen(false);setFiltersOpen(analysisOpen?true:!filtersOpen)}}><span aria-hidden="true">☷</span><span>{filtersOpen&&!analysisOpen?'Hide filters':'Show filters'}{player!=='all'||outcome.length||shot.length||length!=='all'||phase!=='all'||keyOnly||outsideOnly?' · Active':''}</span><span aria-hidden="true">{filtersOpen?'›':'‹'}</span></button></div>
 {!readOnly&&connecting&&<form className="vr-connect" onSubmit={connect}><label>Original match video<input className="ui-input" type="url" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Paste the original Red Bull TV, YouTube or direct video link" required/></label><button className="ui-btn" data-variant="primary">Connect video</button><p>Saved in this browser only. Use the original broadcast so the recorded times match.</p>{error&&<p role="alert">{error}</p>}</form>}
 {uploadOpen&&<VideoUploadWizard firstScouted={rawPoints.find(p=>p.start!==null)?{id:rawPoints.find(p=>p.start!==null)!.id,start:firstRecorded!,label:pointScore(rawPoints.find(p=>p.start!==null)!)}:null} initialSetup={analysisSetup} videoId={hostedVideo?.id} hostedVideo={hostedVideo} players={data.players.map(p=>p.name)} playerIds={data.players.map(p=>p.id)} initialOffset={location.pathname.includes('53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa')?18881:0} onClose={()=>setUploadOpen(false)} onComplete={(file,offset,setup)=>{setSourceChoice(file?(broadcast?'broadcast':'local'):'uploaded');setAnalysisSetup(setup);if(file){setUploadFile(file);setLocalFile({url:URL.createObjectURL(file),name:file.name,size:file.size})}else{setUploadFile(null);setHostedVideo(v=>v?{...v,offset}:v)}setVideoStart(offset);setDuration(0);setMode('full');setCommand({time:file&&broadcast?clock:setup.matchStart,serial:Date.now(),play:false});setClock(file&&broadcast?clock:setup.matchStart);setError('');setConnecting(false);setUploadOpen(false);setAnalysisOpen(true)}}/>}

 {source&&<div className="vr-source-choice" role="group" aria-label="Video source">
 <span>Watch</span>
 {broadcast&&<button className="ui-btn" aria-pressed={activeSource==='broadcast'} data-variant={activeSource==='broadcast'?'primary':'default'} onClick={()=>switchSource('broadcast')}>{broadcast.kind==='redbull'?'Red Bull TV':broadcast.kind==='youtube'?'YouTube':'Original video'}</button>}
 {hostedVideo&&<button className="ui-btn" aria-pressed={activeSource==='uploaded'} data-variant={activeSource==='uploaded'?'primary':'default'} onClick={()=>switchSource('uploaded')}>Uploaded video</button>}
 {localFile&&<button className="ui-btn" aria-pressed={activeSource==='local'} data-variant={activeSource==='local'?'primary':'default'} onClick={()=>switchSource('local')}>Local preview</button>}
 {activeSource==='broadcast'&&!hostedVideo&&<small>Review points now. Upload a video when you’re ready for analysis.</small>}
 </div>}
 {activeSource==='broadcast'&&liveClock&&<form className="vr-broadcast-alignment" onSubmit={e=>{e.preventDefault();void saveAlignment()}}>
 <div><strong>{needsBroadcastAlignment?'Align this live broadcast with its replay':'Replay alignment'}</strong><p>{needsBroadcastAlignment?'These points use a live-stream clock. Align the first recorded point with this replay to enable point navigation.':'Point navigation uses the replay anchor; scouting data is unchanged.'}</p><p role="status">{alignmentStatus}</p></div>
 {canAlign&&<><label>First recorded point in replay<input className="ui-input" aria-label="First recorded point in replay" placeholder="HH:MM:SS" value={anchorText} onChange={e=>setAnchorText(e.target.value)}/></label><button type="button" onClick={()=>void saveAlignment()} className="ui-btn" disabled={alignmentBusy||parseTime(anchorText)===null}>{alignmentBusy?'Saving…':'Save alignment to match'}</button></>}
 </form>}

 <div className={`vr-workspace${analysisOpen?' va-drawer-open':filtersOpen?'':' vr-filters-collapsed'}`}><div className="vr-main"><div className="vr-watch"><div className="vr-watch-video">

 {source?.kind==='redbull'?<RedbullReviewPlayer key={source.url} url={source.url} command={command}/>:source?<ReplayPlayer captureFrames={analysisPlayback} source={source} command={command} stopAt={clipEnd} loop={loop} playWindows={mode==='continuous'?skipWindows:undefined} onTime={(t,d)=>{setClock(t);setDuration(d);if(mode!=='loop'){const current=all.filter(p=>p.start!==null&&p.end!==null&&t>=Math.max(0,p.start-3)&&t<=p.end+3).sort((a,b)=>b.start!-a.start!)[0];if(current)setSelected(current.id)}}}/>:<div className="vr-empty"><h3>Bring this match to life</h3><p>{all.filter(p=>p.start!==null).length} points have video timestamps ready to replay.</p><p>Connect the original broadcast above to watch them here.</p></div>}

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

{!readOnly&&analysisPlayback&&published.result&&hostedVideo?.id===published.result.videoId&&(!localFile||(localFile.name===hostedVideo.name&&localFile.size===hostedVideo.size))?<LabVisionMiniature key={published.result.id+':'+(localFile?.url??hostedVideo.id)} result={published.result} clock={clock} onSeek={seek} toolbarHost={courtTools}/>:localPilot&&activeSource==='local'&&!hostedVideo&&localFile&&location.pathname.includes('53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa')&&<LabVisionMiniature key={localFile.url} clock={clock} onSeek={seek} toolbarHost={courtTools}/>}
</div></div>{analysisPlayback&&published.result&&<VideoMovement initialKey={movementPlayer} key={published.result.id} result={published.result} clock={clock} onSeek={t=>{setMode('full');seek(t,false)}}/>}<MatchVideoTimeline activityWindows={activeWindows} activityReady={!!detectedActivity||activeSource==='local'&&activityWindows.length>0} players={data.players} points={all} filtered={filtered} clock={clock} duration={duration} selected={selected} onChoose={choose} onSeek={t=>{setMode('full');seek(t)}} onScrub={t=>{setMode('full');seek(t,false)}} moments={savedMoments} enabled={!!source&&!needsBroadcastAlignment}/>{savedMoments.length>0&&<details open={momentsOpen} onToggle={e=>setMomentsOpen(e.currentTarget.open)} className="vr-saved-moments"><summary>Saved moments · {savedMoments.length}<small> · This browser</small></summary><div>{savedMoments.map(m=><button className="ui-btn" key={m.time} title={m.note?`${m.label} · ${m.note}`:m.label} onClick={()=>{setMode('full');setSelected(m.pointId);seek(m.time);setClipEnd(m.end??null)}}><span>{timeLabel(m.time)}{m.end?` – ${timeLabel(m.end)}`:''} · {m.label}</span>{!!m.labels?.length&&<span className="vr-saved-labels">{m.labels.map(label=><span key={label}>{label}</span>)}</span>}{m.note&&<small className="vr-moment-note">{m.note}</small>}</button>)}</div></details>}{error&&!connecting&&source&&<p role="alert">{error}</p>}<ReplayMomentum playerFiltered={player!=='all'} points={all} players={data.players} sets={data.sets} filtered={filtered} selected={selected} onChoose={choose}/></div><aside className="vr-sidebar" id="review-filters" hidden={!filtersOpen||analysisOpen}> <div className="vr-chip-filters"><div className="vr-section-head"><h3>Quick filters</h3><small>{filtered.length} points</small></div>
 <div className="vr-chips" role="group" aria-label="Quick point filters"><button className="ui-btn" aria-pressed={keyOnly} data-variant={keyOnly?'primary':'default'} onClick={()=>setKeyOnly(!keyOnly)}>Key points</button><button className="ui-btn" aria-pressed={(length==='extended')} data-variant={(length==='extended')?'primary':'default'} onClick={()=>setLength((length==='extended')?'all':'extended')}>Long rallies · 10+ hits</button></div>
 <div className="vr-chip-row" role="group" aria-label="Attributed player"><b>Player</b><div className="vr-chips"><button className="ui-btn" aria-pressed={player==='all'} data-variant={player==='all'?'primary':'default'} onClick={()=>{setPlayer('all');setPhase('all')}}>All players</button>{data.players.map((p,i)=><button key={p.id} className="ui-btn vr-player-chip" aria-pressed={player===String(i)} data-variant={player===String(i)?'primary':'default'} onClick={()=>{setPlayer(player===String(i)?'all':String(i));if(player===String(i))setPhase('all')}}><span className="vr-player-key" data-team={i<2?'a':'b'} data-second={i%2===1}/><img src={p.avatar} alt=""/>{p.shortName}</button>)}</div></div>
 <div className="vr-chip-row" role="group" aria-label="Outcome"><b>Outcome</b><div className="vr-chips"><button className="ui-btn" aria-pressed={!outcome.length} data-variant={!outcome.length?'primary':'default'} onClick={()=>setOutcome([])}>All outcomes</button>{Object.entries(outcomes).map(([value,label])=><button key={value} className="ui-btn" aria-pressed={outcome.includes(value)} data-variant={outcome.includes(value)?'primary':'default'} onClick={()=>setOutcome(toggle(outcome,value))}>{label}</button>)}</div></div>
 <button className="ui-btn" aria-pressed={outsideOnly} data-variant={outsideOnly?'primary':'default'} onClick={()=>setOutsideOnly(!outsideOnly)}>Outside recovery attempts</button><details className="vr-more-filters"><summary>More filters{shot.length||length!=='all'||phase!=='all'||keyOnly||outsideOnly?' · Active':''}</summary><div className="vr-advanced">
 <div className="vr-chip-row" role="group" aria-label="Ending shot"><b>Ending shot</b><div className="vr-chips"><button className="ui-btn" aria-pressed={!shot.length} data-variant={!shot.length?'primary':'default'} onClick={()=>setShot([])}>All shots</button>{[...new Set(all.flatMap(p=>p.shot?[p.shot]:[]))].map(value=><button key={value} className="ui-btn" aria-pressed={shot.includes(value)} data-variant={shot.includes(value)?'primary':'default'} onClick={()=>setShot(toggle(shot,value))}>{value.replaceAll('_',' ')}</button>)}</div></div>
 <div className="vr-chip-row" role="group" aria-label="Rally length"><b>Rally length</b><div className="vr-chips">{[['all','Any length'],['short','1–3 hits'],['medium','4–6 hits'],['long','7–9 hits'],['extended','10+ hits'],['unknown','Not recorded']].map(([value,label])=><button key={value} className="ui-btn" aria-pressed={length===value} data-variant={length===value?'primary':'default'} onClick={()=>setLength(value)}>{label}</button>)}</div></div>
 <div className="vr-chip-row" role="group" aria-label="Point context"><b>Context</b><div className="vr-chips">{[['all','Serve & return'],['serve','Serving'],['return','Returning']].map(([value,label])=><button key={value} className="ui-btn" aria-pressed={phase===value} disabled={value!=='all'&&player==='all'} data-variant={phase===value?'primary':'default'} onClick={()=>setPhase(value)}>{label}</button>)}<button className="ui-btn" data-variant="ghost" onClick={()=>{setPlayer('all');setOutcome([]);setShot([]);setLength('all');setPhase('all');setKeyOnly(false);setOutsideOnly(false)}}>Clear filters</button></div></div>
 <p className="vr-filter-note">Rally length uses recorded taps, not a verified full shot count. Select a player to filter their pair’s serve or return. Outcome and shot chips allow multiple selections.</p>
 </div></details></div>
</aside>{!readOnly&&reviewContext&&<aside className="va-drawer" id="video-analysis-drawer" aria-label="Video & analysis" hidden={!analysisOpen}>
 <header><h2>Video & analysis</h2><button className="ui-btn" aria-label="Close video and analysis" onClick={()=>setAnalysisOpen(false)}>Close</button></header>
 <HostedVideoUpload context={reviewContext} file={uploadFile} offset={videoStart} duration={analysisSetup?.duration||(activeSource==='local'?duration:0)} onStatus={setUploadStatus} onChoose={()=>setUploadOpen(true)} onHosted={v=>{setHostedVideo(v);if(!localFile)setVideoStart(v.offset)}}/>
 {hostedVideo?<LocalAnalysis key={hostedVideo.id} video={hostedVideo} setup={analysisSetup} players={data.players} onStatus={setAnalysisStatus} onPrepare={setup=>{setAnalysisSetup(setup);setUploadOpen(true)}}/>:<div className="va-section"><h3>{analysisSetup?.confirmed?'Setup confirmed':'Match setup'}</h3><p>{analysisSetup?.confirmed?'Court and player selections are saved. Upload the video to start analysis.':'Choose a video, select the match start and confirm court and players before analysis.'}</p></div>}
 <details className="va-source-settings"><summary>Video source settings</summary><button className="ui-btn" onClick={()=>setUploadOpen(true)}>Choose another video</button><button className="ui-btn" onClick={()=>setConnecting(!connecting)}>Connect video link</button>
 {localPilot&&!readOnly&&<details className="vr-video-setup"><summary>Video setup</summary><div className="vr-local-upload"><label className="ui-btn">Choose local video<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e=>{const file=e.target.files?.[0];if(!file)return;setSourceChoice('local');setAnalysisSetup(null);setUploadFile(file);setLocalFile({url:URL.createObjectURL(file),name:file.name,size:file.size});setVideoStart(location.pathname.includes("53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa")?18881:0);setDuration(0);setMode('full');setCommand({time:0,serial:0,play:false});setClock(0);setError('');setConnecting(false);e.target.value=''}}/></label><span>{localFile?.name??'Video stays on this computer'}</span>{localFile&&<label>Original broadcast time at video start <input className="ui-input" aria-label="Broadcast offset in seconds" type="number" min="0" step="0.1" value={videoStart} onChange={e=>setVideoStart(Math.max(0,Number(e.target.value)||0))}/><small>{timeLabel(videoStart)} · seconds; adjusts scouting timestamps only</small></label>}</div></details>}
</details>
 </aside>}</div>
 <section className="vr-rallies"><div className="vr-section-head"><h3>Matching rallies · {filtered.length}</h3><span>Choose any point to review</span></div>{!filtered.length?<p>No points match these filters. Try another player or outcome.</p>:<div className="vr-filmstrip">{filtered.map(p=><button className="ui-btn vr-rally" data-variant="ghost" aria-pressed={selected===p.id} onClick={()=>choose(p.id)} key={p.id}><div className="vr-rally-image">{p.player!==null&&<img loading="lazy" src={data.players[p.player].avatar} alt=""/>}<span>{p.start===null?'No timestamp':duration>0&&(p.start<0||p.start>=duration)?'Outside this video':timeLabel(p.start)}</span></div><b>Point {p.number} · Set {p.before.sets.length}</b><span>{outcomes[p.outcome]??p.outcome}</span><small>{p.player!==null?data.players[p.player].shortName:'Unclassified'} · {p.before.currentGame.a}–{p.before.currentGame.b}</small></button>)}</div>}<p className="vr-note">Player portraits identify each rally. Video frame thumbnails are not available in the saved scouting.</p></section>

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
