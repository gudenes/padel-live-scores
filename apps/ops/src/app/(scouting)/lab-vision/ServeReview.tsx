'use client'
import {useEffect,useRef,useState} from 'react'
import {useServePlayers} from './useServePlayers'
export default function ServeReview({detail,jobId,onSaved}:{detail:any;jobId:string;onSaved:(a:any)=>void}){
 const [candidates,setCandidates]=useState<any[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[selected,setSelected]=useState<any>(null),[hintOnly,setHintOnly]=useState(true),[pending,setPending]=useState(false)
 const [time,setTime]=useState(0),[now,setNow]=useState(0),[player,setPlayer]=useState(''),[box,setBox]=useState<any>(null),[editing,setEditing]=useState(false),[confirmed,setConfirmed]=useState(false),[attempt,setAttempt]=useState('Unknown'),[view,setView]=useState('Unknown')
 const [page,setPage]=useState(0)
 const [retired,setRetired]=useState<string[]>([])
 const [saveStatus,setSaveStatus]=useState('')
 const [zoom,setZoom]=useState(1)
 const viewport=useRef<HTMLDivElement>(null)
 const focusPoint=useRef({x:.5,y:.5})
 const focusBox=(b:any)=>{focusPoint.current=b?{x:b.x+b.width/2,y:b.y+b.height/2}:{x:.5,y:.5};setZoom(2);requestAnimationFrame(()=>{centerZoom();viewport.current?.scrollIntoView({block:"center",behavior:"smooth"})})}
 const centerZoom=()=>{const el=viewport.current;if(el){el.scrollLeft=focusPoint.current.x*el.scrollWidth-el.clientWidth/2;el.scrollTop=focusPoint.current.y*el.scrollHeight-el.clientHeight/2}}
 useEffect(()=>{centerZoom()},[zoom])
 const video=useRef<HTMLVideoElement>(null),stop=useRef<number|null>(null)
 const roles=useServePlayers(detail,time,now,selected,player,setPlayer,()=>setConfirmed(false),()=>{video.current?.pause();stop.current=null},focusBox)
 const latest=detail.annotations.filter((a:any)=>!retired.includes(a.id)&&!detail.annotations.some((b:any)=>b.supersedes===a.id))
 const reviewed=(id:string)=>latest.find((a:any)=>a.candidateId===id)
 const list=candidates.filter(c=>(!hintOnly||c.serveHint)&&(!pending||!reviewed(c.id)||reviewed(c.id).serveDecision==='uncertain'))
 const choose=(c:any)=>{const old=reviewed(c.id);setSaveStatus('');setZoom(1);setSelected({...c,savedParticipants:old?.participants,savedTime:old?.time});const at=list.findIndex(x=>x.id===c.id);if(at>=0)setPage(Math.floor(at/40));setTime(old?.time??c.time);setPlayer(old?.player??c.player);setBox(old?.box??c.box);setAttempt(old?.serveAttempt??'Unknown');setView(old?.viewpoint??'Unknown');setConfirmed(false);setEditing(false);stop.current=null;if(video.current){video.current.pause();video.current.currentTime=old?.time??c.time}setMessage('Review the clip, correct contact time and player, then decide.')}
 const load=async()=>{setBusy(true);try{const r=await fetch(`/api/internal/lab-vision/workspace?job=${jobId}&candidates=1`);const d=await r.json();if(!r.ok)throw Error(d.error);setCandidates(d.candidates);setMessage(`${d.candidates.length} possible contacts ready. These are unconfirmed motion proposals.`);const first=d.candidates.find((c:any)=>!hintOnly||c.serveHint);if(first)choose(first)}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>()=>{stop.current=null},[])
 const play=()=>{const v=video.current;if(!v||!selected)return;setEditing(false);v.currentTime=Math.max(0,time-1.5);stop.current=Math.min(v.duration,time+1);void v.play().catch(()=>setMessage('Press play in the video to review.'))}
 const toggleBoxEditing=()=>{
  if(editing){setEditing(false);return}
  const v=video.current
  if(!v||!selected)return
  v.pause();stop.current=null
  const frameTime=v.currentTime
  if(Math.abs(frameTime-time)>1/60){setBox(null);setConfirmed(false)}
  setTime(frameTime);setNow(frameTime);setEditing(false)
 }
 const decide=async(decision:string,confirmNow=false)=>{if(!selected||busy)return;if(decision==='serve'&&(!roles.ready||!(confirmed||confirmNow))){setSaveStatus('Select server and receiver and check all four boxes, or mark players not visible.');return;}setBusy(true);setSaveStatus('Saving decision…');try{const old=reviewed(selected.id);const payload={jobId,candidateId:selected.id,serveDecision:decision,supersedes:old?.id||'',kind:'Shot contact',time,start:Math.max(0,time-1.5),end:Math.min(detail.video.duration,time+1),player,shot:decision==='serve'?'Serve':'Unknown',side:'Unknown',direction:'Unknown',status:decision==='serve'?'verified':decision==='not_serve'?'excluded':'needs_review',confirmed:confirmed||confirmNow,participants:roles.participants,box:roles.participants.find(p=>p.player===player)?.box??null,boxOrigin:selected.box?'pose-adjusted':'human',serveAttempt:attempt,viewpoint:view,notes:decision==='not_serve'?'Not a serve; does not imply no shot contact.':'Serve-focused review of a pose motion proposal.'};
 const send=()=>fetch('/api/internal/lab-vision/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 let r=await send(),d=await r.json();
 if(r.status===409&&d.code==='missing_revision'){
  const fresh=await fetch('/api/internal/lab-vision/workspace?job='+jobId);
  if(!fresh.ok)throw Error('Could not refresh saved annotations. Your edits are still here; try again.');
  const data=await fresh.json();
  const current=data.annotations.filter((a:any)=>a.candidateId===selected.id&&!data.annotations.some((b:any)=>b.supersedes===a.id)).at(-1);
  if(old)setRetired(ids=>[...ids,old.id]);
  payload.supersedes=current?.id??'';
  r=await send();d=await r.json();
 }
 if(!r.ok)throw Error(d.error);onSaved(d.annotation);const i=list.findIndex(c=>c.id===selected.id),next=list[i+1];if(next)choose(next);setSaveStatus(next?'Saved. Next proposal loaded.':'Saved. End of this queue.');setMessage(next?'Decision saved. Next proposal selected.':'Decision saved. End of this queue.')}catch(e){setSaveStatus('Could not save: '+(e as Error).message);setMessage((e as Error).message)}finally{setBusy(false)}}

 const stepFrames=(count:number)=>{const v=video.current;if(!v||!Number.isFinite(v.duration))return;stop.current=null;v.pause();setEditing(false);v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+count/30))}
 const togglePlayback=()=>{const v=video.current;if(!v)return;stop.current=null;if(v.paused)void v.play().catch(()=>setMessage('Unable to play video.'));else v.pause()}
 const markContact=()=>{const v=video.current;if(!v||!selected)return;v.pause();stop.current=null;setTime(v.currentTime);setNow(v.currentTime);setConfirmed(false);setMessage('Contact frame marked. Check all four roles and boxes before approving.');setSaveStatus('Contact marked at '+v.currentTime.toFixed(3)+' s. Now check player roles and boxes; this does not save or advance the proposal.')}
 const shortcut=(e:React.KeyboardEvent<HTMLElement>)=>{
  const target=e.target as HTMLElement
  if(target.closest('input,select,textarea,[contenteditable="true"]')||e.ctrlKey||e.metaKey||e.altKey||busy)return
  const key=e.key.toLowerCase()
  const known=['z','x','c','v','r','j','l','1','2','3','0','+','=','-','enter','n','u']
  if(!known.includes(key))return
  if(key==='u'&&!e.shiftKey)return
  e.preventDefault();e.stopPropagation()
  if(e.repeat&&!['z','c','j','l'].includes(key))return
  if(key==='z'||key==='c')stepFrames((key==='z'?-1:1)*(e.shiftKey?10:1))
  else if(key==='j'||key==='l')stepFrames(key==='j'?-30:30)
  else if(key==='x')togglePlayback()
  else if(key==='v')markContact()
  else if(key==='r')play()
  else if(['1','2','3'].includes(key))roles.changeMode(key==='1'?'server':key==='2'?'receiver':'edit')
  else if(key==='0')setZoom(1)
  else if(key==='+'||key==='=')setZoom(z=>Math.min(4,z+1))
  else if(key==='-')setZoom(z=>Math.max(1,z-1))
  else if(key==='enter'){if(selected&&roles.ready)void decide('serve',true);else setSaveStatus('Select server and receiver and check all four boxes, or mark players not visible, before approving.')}
  else if(key==='n'&&selected)void decide('not_serve')
  else if(key==='u'&&selected)void decide('uncertain')
 }
 return <section tabIndex={0} onKeyDown={shortcut} aria-label="Serve review keyboard workspace"><h2>Review serves</h2><p>Review possible contacts across the match. Front and back views share the same Serve label. Motion proposals may include other shots, gestures and replays, and may miss serves.</p><div className="lv-controls"><button className="ui-btn" data-variant="primary" disabled={busy} onClick={load}>{busy?'Working…':candidates.length?'Reload proposals':'Generate contact proposals'}</button><label><input type="checkbox" checked={hintOnly} onChange={e=>{setHintOnly(e.target.checked);setPage(0)}}/> Likely serve positions only</label><label><input type="checkbox" checked={pending} onChange={e=>{setPending(e.target.checked);setPage(0)}}/> Pending / uncertain only</label></div><p role="status">{message}</p><p>{candidates.filter(c=>['serve','not_serve'].includes(reviewed(c.id)?.serveDecision)).length} / {candidates.length} reviewed · {list.length} in this view</p>
 <div className="lv-annotation"><div className="lv-card"><div className="lv-controls lv-zoom-tools"><strong>Inspect frame</strong>{[1,2,3,4].map(z=><button className="ui-btn" key={z} data-variant={zoom===z?'primary':'default'} onClick={()=>{const el=viewport.current;if(el)focusPoint.current={x:(el.scrollLeft+el.clientWidth/2)/el.scrollWidth,y:(el.scrollTop+el.clientHeight/2)/el.scrollHeight};setZoom(z)}}>{z===1?'Fit':z+'×'}</button>)}<small>{zoom>1?'Scroll to move around the enlarged frame.':'Adjust a player box to zoom directly to them.'}</small></div><div className="lv-zoom-viewport" ref={viewport} style={{aspectRatio:(detail.tracking?.manifest?.sourceDimensions??[16,9]).join('/')}}><div className="lv-video-frame" style={{width:zoom*100+'%'}}><video ref={video} src={detail.video.url} controls={zoom===1&&!roles.isEditing} preload="metadata" onPlay={()=>setEditing(false)} onTimeUpdate={()=>{const v=video.current!;setNow(v.currentTime);if(stop.current!==null&&v.currentTime>=stop.current){v.pause();stop.current=null}}}/>{roles.overlay}</div></div><div className="lv-controls"><button className="ui-btn" onClick={togglePlayback}>Play / pause · X</button><span>Frame at {now.toFixed(3)} s</span><button className="ui-btn" disabled={!selected} onClick={play}>Replay proposal · R</button></div><div className="lv-controls"><strong>Step frames</strong>{[-30,-10,-1,1,10,30].map(n=><button className="ui-btn" key={n} onClick={()=>stepFrames(n)}>{n>0?'+':'−'}{Math.abs(n)}{Math.abs(n)===1?' frame':' frames'}</button>)}<button className="ui-btn" disabled={!selected} onClick={markContact}>Confirm contact · V</button></div>{saveStatus.startsWith('Contact marked')&&<div className="lv-note" role="status" aria-live="polite">✓ {saveStatus}</div>}<details className="lv-note"><summary>Keyboard shortcuts</summary><p><b>Z / C</b> previous / next frame · <b>Shift + Z / C</b> jump 10 frames · <b>J / L</b> jump 30 frames (1 s)</p><p><b>X</b> play / pause · <b>R</b> replay proposal · <b>V</b> mark contact</p><p><b>1</b> select server · <b>2</b> select receiver · <b>3</b> edit boxes · <b>+ / −</b> zoom · <b>0</b> fit</p><p><b>Enter</b> confirm review, approve &amp; next · <b>N</b> not a serve &amp; next · <b>Shift + U</b> uncertain &amp; next</p><small>Click within this review area to use shortcuts. Disabled while typing or choosing dropdown values. Frame steps use the 30 fps analysis video.</small></details>{roles.controls}<div className="lv-controls"><button className="ui-btn" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous proposals</button><span>Page {page+1} / {Math.max(1,Math.ceil(list.length/40))}</span><button className="ui-btn" disabled={(page+1)*40>=list.length} onClick={()=>setPage(p=>p+1)}>More proposals</button></div><div className="lv-saved" style={{maxHeight:250,overflow:'auto'}}>{list.slice(page*40,page*40+40).map((c,i)=><button className="ui-btn" data-variant={selected?.id===c.id?'primary':'default'} key={c.id} onClick={()=>choose(c)}>{page*40+i+1} · {Math.floor(c.time/60)}:{(c.time%60).toFixed(1).padStart(4,'0')} · {c.player} · {reviewed(c.id)?.serveDecision??(c.serveHint?'serve position?':'to review')}</button>)}</div></div>
 <div className="lv-card lv-form"><h3>{selected?'Review this proposal':'Select a proposal'}</h3>{selected&&<><p>{selected.reason} · Contact {time.toFixed(3)} s</p><label>Server<select value={player} onChange={e=>{setPlayer(e.target.value);setBox(null);setConfirmed(false)}}>{detail.players.map((p:any)=><option key={p.name}>{p.name}</option>)}</select></label><label>Serve attempt<select value={attempt} onChange={e=>setAttempt(e.target.value)}>{['Unknown','First','Second'].map(v=><option key={v}>{v}</option>)}</select></label><label>Viewpoint<select value={view} onChange={e=>setView(e.target.value)}>{['Unknown','Front','Back','Side / oblique'].map(v=><option key={v}>{v}</option>)}</select></label><button className="ui-btn" onClick={toggleBoxEditing}>{'Propose all boxes on current frame'}</button>{editing&&<small>Editing the displayed frame at {time.toFixed(3)} s. Drag around the server, then confirm the contact time.</small>}<label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I checked contact time, all four roles and boxes</label><button className="ui-btn" data-variant="primary" disabled={busy||!confirmed||!roles.ready} onClick={()=>decide('serve')}>{busy?'Saving…':'Approve serve & next · Enter'}</button>{saveStatus&&<p role="status" aria-live="polite" className="lv-note">{saveStatus}</p>}<button className="ui-btn" disabled={busy} onClick={()=>decide('not_serve')}>Not a serve & next · N</button><button className="ui-btn" disabled={busy} onClick={()=>decide('uncertain')}>Uncertain & next</button><small>Approved serves are human labels. Rejected proposals are excluded from serve training. Add missed serves in Annotate & improve.</small></>}</div></div></section>
}
