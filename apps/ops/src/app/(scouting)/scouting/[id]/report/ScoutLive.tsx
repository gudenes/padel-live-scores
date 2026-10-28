'use client'
import {useEffect,useRef,useState} from 'react'
import {liveVideoClock,youtubeId,type LivePlayer} from '@/lib/scouting/live-video-clock'
import styles from './scout-live.module.css'
import {restoreLiveVideo} from '@/lib/scouting/restore-live-video'
import ResizableScoutWorkspace from './ResizableScoutWorkspace'
import {ScoutScoreboard,ScoutPlayback,ScoutHeaderCommands,type WorkspaceUI} from './ScoutWorkspaceChrome'
type Player=LivePlayer&{playVideo:()=>void;pauseVideo:()=>void;seekTo:(time:number,allow:boolean)=>void;setPlaybackRate:(rate:number)=>void;getAvailablePlaybackRates:()=>number[];destroy:()=>void}
type API={Player:new(node:HTMLElement,options:object)=>Player}
type Snapshot=ReturnType<ReturnType<typeof liveVideoClock>['sample']>
type Capture={action:string;time:number;at:string;epoch:number}
type SavedPoint={id:string;number:number;start:number;end:number;player:string}
type Bridge={workspace?:WorkspaceUI;workspaceAction?:(key:string,value?:string)=>boolean;points?:SavedPoint[];reviewPoint?:(id:string,position?:'start'|'end')=>void;videoId:string;sessionId:string;snapshot:()=>Snapshot;seek:(time:number)=>void;pause:(paused:boolean)=>void;rate:(rate:number)=>void;pending?:()=>boolean;finish?:()=>Promise<void>;syncStatus?:()=>{status:string;error?:string};exportState?:()=>unknown;record:(capture:Capture)=>void}
type Host=Window&{__pnLiveScout?:Bridge}
async function youtube():Promise<API>{
 const win=window as unknown as {YT?:API}
 if(win.YT?.Player)return win.YT
 if(!document.querySelector('script[data-live-youtube]')){const script=document.createElement('script');script.dataset.liveYoutube='1';script.src='https://www.youtube.com/iframe_api';document.head.appendChild(script)}
 return new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(win.YT?.Player){clearInterval(timer);resolve(win.YT)}else if(Date.now()-started>15000){clearInterval(timer);reject(Error('YouTube could not load. Check the connection and reconnect.'))}},100)})
}
const clock=(n:number)=>`${Math.floor(n/3600).toString().padStart(2,'0')}:${Math.floor(n/60%60).toString().padStart(2,'0')}:${(n%60).toFixed(2).padStart(5,'0')}`
export default function ScoutLive({matchId,onExit,localTest}:{matchId:string;onExit:()=>void;localTest:boolean}){
 const [draft,setDraft]=useState(''),[videoId,setVideoId]=useState(''),[attempt,setAttempt]=useState(0),[error,setError]=useState(''),[ready,setReady]=useState(false),[sample,setSample]=useState<Snapshot|null>(null),[captures,setCaptures]=useState<Capture[]>([]),[state,setState]=useState('Disconnected')
 const [connectionOpen,setConnectionOpen]=useState(false),[finishing,setFinishing]=useState(false),[saveStatus,setSaveStatus]=useState('Connecting'),[saveError,setSaveError]=useState('')
 const [savedPoints,setSavedPoints]=useState<SavedPoint[]>([]),[pendingRally,setPendingRally]=useState(false)
 const [workspaceUI,setWorkspaceUI]=useState<WorkspaceUI|null>(null)
 const [restoring,setRestoring]=useState(true)
 const linkEdited=useRef(false)
 const host=useRef<HTMLDivElement>(null),player=useRef<Player|null>(null),bridge=useRef<Bridge|null>(null)
 useEffect(()=>{const update=()=>setWorkspaceUI((window as Host).__pnLiveScout?.workspace??null);window.addEventListener('pn-scout-workspace',update);return()=>window.removeEventListener('pn-scout-workspace',update)},[])
 function workspaceAction(key:string,value?:string){bridge.current?.workspaceAction?.(key,value)}
 useEffect(()=>{
  let active=true;const key='pn-live-video:'+matchId,controller=new AbortController();
  setRestoring(true);setConnectionOpen(false);
  let cached='';try{cached=localStorage.getItem(key)??''}catch{}
  const timeout=setTimeout(()=>controller.abort(),15000);
  void restoreLiveVideo({matchId,localTest,cached,signal:controller.signal}).then(url=>{
   if(!active||linkEdited.current)return;
   if(url){setDraft(url);setVideoId(youtubeId(url)!);try{localStorage.setItem(key,url)}catch{}}
   else setConnectionOpen(true);
  }).catch(()=>{if(active&&!linkEdited.current){setError('Could not restore the saved video. Use Video link to retry; saved scouting is unchanged.');setConnectionOpen(true)}}).finally(()=>{clearTimeout(timeout);if(active)setRestoring(false)});
  return()=>{active=false;clearTimeout(timeout);controller.abort()};
 },[matchId,localTest]);
 useEffect(()=>{
  if(!videoId)return
  let active=true,instance:Player|null=null,interval:ReturnType<typeof setInterval>|undefined
  setReady(false);setWorkspaceUI(null);setError('');setSample(null);setState('Connecting');setCaptures([]);setSavedPoints([])
  const sessionId=crypto.randomUUID(),timeline=liveVideoClock(videoId,sessionId)
  youtube().then(api=>{if(!active||!host.current)return;const node=document.createElement('div');host.current.replaceChildren(node)
   instance=new api.Player(node,{videoId,width:'100%',height:'100%',playerVars:{playsinline:1,origin:location.origin},events:{
    onReady:()=>{if(!active||!instance)return;player.current=instance
     const current:Bridge={videoId,sessionId,snapshot:()=>timeline.sample(instance!),seek:time=>{timeline.markSeek();instance!.seekTo(Math.max(0,time),true)},pause:paused=>paused?instance!.pauseVideo():instance!.playVideo(),rate:rate=>{if(!instance!.getAvailablePlaybackRates().includes(rate))throw Error('This stream does not offer that playback speed.');instance!.setPlaybackRate(rate)},record:c=>setCaptures(rows=>[c,...rows].slice(0,20))}
     bridge.current=current;(window as Host).__pnLiveScout=current;setReady(true);setConnectionOpen(false)
     interval=setInterval(()=>{try{const s=current.snapshot();setSample(s);if(current.points)setSavedPoints(current.points);setPendingRally(!!current.pending?.());const sync=current.syncStatus?.();setSaveStatus(sync?.status??'Loading');setSaveError(sync?.error??'');setState(s.seeking?'Timeline changed · settling':s.readyState===0?'Loading / buffering':s.ended?'Ended':s.paused?'Paused':'Playing')}catch(e){setError((e as Error).message)}},200)
    },onError:(event:{data:number})=>{if(!active)return;setReady(false);setState('Unavailable');setError([101,150].includes(event.data)?'The broadcaster does not allow embedded playback. Use the extension for this video.':`YouTube playback error ${event.data}. This video may be unavailable or restricted.`)}
   }})
  }).catch(e=>{if(active)setError(e.message)})
  return()=>{active=false;clearInterval(interval);if((window as Host).__pnLiveScout===bridge.current)delete (window as Host).__pnLiveScout;bridge.current=null;player.current=null;instance?.destroy()}
 },[videoId,attempt])
 function connect(e:React.FormEvent){e.preventDefault();const id=youtubeId(draft);if(!id){setError('Paste a valid HTTPS YouTube watch, live, or youtu.be link.');return}if(bridge.current?.pending?.()){setError('Finish or cancel the current rally before reconnecting.');return}linkEdited.current=true;try{localStorage.setItem('pn-live-video:'+matchId,'https://www.youtube.com/watch?v='+id)}catch{}setVideoId(id);setAttempt(a=>a+1)}
 function jumpToPoint(id:string,position:'start'|'end'='start'){try{if(!bridge.current?.reviewPoint)throw Error('Wait for scouting to load.');bridge.current.reviewPoint(id,position);setError('')}catch(e){setError((e as Error).message)}}
 async function finish(){if(!bridge.current?.finish){setError('Wait for the scouting controls to load.');return}setFinishing(true);setError('');try{await bridge.current.finish();window.location.href=`/scouting/${matchId}/report${localTest?'?liveReview=1':''}`}catch(e){setError((e as Error).message);setFinishing(false)}}
 function download(){if(!bridge.current?.exportState){setError('Wait for the scouting controls to finish loading before exporting.');return}const value={format:'padel-nachos-live-lab',version:1,matchId,videoUrl:'https://www.youtube.com/watch?v='+videoId,exportedAt:new Date().toISOString(),timelineWarning:'YouTube playback seconds; live-to-replay offsets and DVR boundaries are not verified.',session:bridge.current?.exportState?.(),recentCaptures:captures};const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`live-scout-${matchId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <main className={styles.root} data-scout-focus="true"><header className={styles.workspaceHeader}>
 <div className={styles.scoreCorner}><ScoutScoreboard ui={workspaceUI} action={workspaceAction}/>{!workspaceUI&&<p className={styles.note}>Scoreboard loads with your scouting session</p>}</div>
 <div className={styles.matchContext}><span className={styles.contextEyebrow}>Scout live{localTest?' · Local test':''}</span><h1>{workspaceUI?.matchInfo?.tournament||workspaceUI?.identity?.split(' · ')[0]||'Match workspace'}</h1><p className={styles.contextMeta}>{workspaceUI?.matchInfo?[workspaceUI.matchInfo.category,workspaceUI.matchInfo.round,workspaceUI.matchInfo.court?(/court/i.test(workspaceUI.matchInfo.court)?workspaceUI.matchInfo.court:'Court '+workspaceUI.matchInfo.court):null].filter(Boolean).join(' · '):workspaceUI?.identity?.split(' · ').slice(1).join(' · ')}</p><button className="ui-btn" data-variant="ghost" onClick={()=>{if(bridge.current?.pending?.()){setError('Finish or cancel the current rally before leaving scouting.');return}onExit()}}>← Match insights</button></div>
 <div className={styles.actions}><ScoutHeaderCommands ui={workspaceUI} action={workspaceAction}/><div className={styles.headerUtilities}><span className={styles.saveStatus} data-state={saveStatus} role="status" title={saveError}>{saveStatus==='saved'?(localTest?'Saved locally':'Saved to server'):saveStatus==='error'||saveStatus==='conflict'?'Save needs attention':'Saving / connecting…'}</span><button className="ui-btn" data-variant="secondary" aria-expanded={connectionOpen} aria-controls="live-video-connection" onClick={()=>{linkEdited.current=true;setConnectionOpen(open=>!open)}}>Video link</button><details className={styles.headerMore}><summary className="ui-btn" aria-label="More workspace actions">More</summary><button className="ui-btn" data-variant="secondary" disabled={!ready} onClick={download}>Export backup</button></details><button className="ui-btn" data-variant="primary" disabled={!ready||finishing} onClick={finish}>{finishing?'Saving…':'Finish scouting'}</button></div></div></header>
 <form id="live-video-connection" hidden={!connectionOpen} className={styles.connect} onSubmit={connect}><label>YouTube video or live stream<input className="ui-input" type="url" required value={draft} onChange={e=>{linkEdited.current=true;setDraft(e.target.value)}} placeholder="https://www.youtube.com/live/…"/></label><button className="ui-btn" data-variant="primary" type="submit">{videoId?'Reconnect video':'Connect video'}</button></form>
 {saveError&&<p role="alert" className={styles.error}>{saveError}</p>}
 {error&&<p role="alert" className={styles.error}>{error}</p>}
 <ResizableScoutWorkspace><section className={styles.videoColumn}><div className={styles.video} ref={host}>{!videoId&&<p>{restoring?'Restoring your saved video…':'No saved video link yet. Paste a YouTube link to begin.'}</p>}</div>
 <div className={styles.status}><span>{state}</span><time>{sample?clock(sample.time):'—'}</time><span className={styles.note}>{ready&&!workspaceUI?'Loading playback controls…':''}</span></div>
 <ScoutPlayback ui={workspaceUI} action={workspaceAction}/>
 <section className={styles.savedPoints} aria-label="Saved scouting points"><div className={styles.header}><strong>Saved points · {savedPoints.length}</strong><button className="ui-btn" data-variant="secondary" disabled={!savedPoints.length||pendingRally||finishing||!!sample?.seeking} onClick={()=>jumpToPoint(savedPoints[savedPoints.length-1].id,'end')}>Continue after last point</button></div><p className={styles.note}>{pendingRally?'Finish or cancel the open rally before jumping.':'Select a point to review here. Continue positions the video at the last saved point’s end; press Play when ready.'}</p><div className={styles.pointButtons}>{savedPoints.map(point=><button key={point.id} className="ui-btn" data-variant="secondary" disabled={pendingRally||finishing||!!sample?.seeking} onClick={()=>jumpToPoint(point.id)} title={`${point.player} · ${clock(point.start)} → ${clock(point.end)}`}>#{point.number} · {clock(point.start)}</button>)}</div></section>
 <details className={styles.diagnostics}><summary>Video diagnostics & timestamp captures</summary>
 <dl className={styles.stats}><div><dt>Player state</dt><dd>{state}</dd></div><div><dt>Video position</dt><dd>{sample?clock(sample.time):'—'}</dd></div><div><dt>Reported duration</dt><dd>{sample?.duration?clock(sample.duration):'—'}</dd></div><div><dt>Timeline changes</dt><dd>{sample?.seekEpoch??0}</dd></div></dl>
 <p className={styles.note}>YouTube does not expose the true live edge or seekable DVR window here. Skip commands are requests to the player; YouTube may clamp them to its available buffer. Use the player’s own LIVE control when available. Seeking, buffering, and reconnecting can invalidate an open rally. Replay timestamps may shift after the broadcast ends.</p>
 <h2 className={styles.captureTitle}>Recent timestamp captures</h2><p className={styles.note}>Read when the scouting action executes. Display refreshes every 200 ms; capture does not use that display timer. Small seeks inside YouTube may not be detectable.</p><ol className={styles.events}>{captures.map((c,i)=><li key={c.at+i}><b>{c.action}</b><span>{clock(c.time)} · timeline {c.epoch}</span><small>{c.at}</small></li>)}</ol></details>
 </section><section className={styles.scout} data-coach-overlay={workspaceUI?.coachOverlay||undefined}>{ready?<iframe title="Live video scouting controls" src={`/scout-web/live-extension/panel.html?matchId=${matchId}&liveLab=${localTest?'1':'0'}`}/>:<p>{restoring?'Looking for your saved match video…':videoId?'Connecting your saved video and scouting controls…':'Add the video link once; it will reconnect automatically next time.'}</p>}</section></ResizableScoutWorkspace>
 </main>
}
