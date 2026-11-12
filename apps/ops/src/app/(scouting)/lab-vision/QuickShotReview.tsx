'use client'
import {useEffect,useRef,useState} from 'react'
import ShotReview from './ShotReview'
import PlayerBox from './PlayerBox'
import {proposeReviewBox} from '@/lib/lab-vision/propose-box'
const strokeKeys=[['Smash','Q'],['Volley','W'],['Vibora','E'],['Bandeja','A'],['Groundstroke','S'],['Lob','D'],['Chiquita','F'],['Block','G'],['Bajada','H'],['Gancho','T'],['Rulo','Y'],['Contrapared','U'],['Serve','5'],['Other','4']]
const clock=(t:number)=>new Date(Math.max(0,t)*1000).toISOString().slice(11,23)
async function api(url:string,body?:any){const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);return d}
export default function QuickShotReview({jobId,detail,onSaved}:{jobId:string;detail:any;onSaved:(a:any)=>void}){
 const [project,setProject]=useState<any>(null),[index,setIndex]=useState(0),[correcting,setCorrecting]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[box,setBox]=useState<any>(null),[boxNote,setBoxNote]=useState(''),[playing,setPlaying]=useState(false),[frameOffset,setFrameOffset]=useState(0)
 const [shot,setShot]=useState('Unknown'),[side,setSide]=useState('Unknown')
 const [playerChoice,setPlayerChoice]=useState<{id:string;name:string}|null>(null),[boxOrigin,setBoxOrigin]=useState('pose-proposal'),[boxRevision,setBoxRevision]=useState(0)
 const boxEdited=useRef(false)
 const [decisionFeedback,setDecisionFeedback]=useState<{decision:string;phase:'saving'|'saved'}|null>(null)
 useEffect(()=>{if(decisionFeedback?.phase!=='saved')return;const timer=setTimeout(()=>setDecisionFeedback(null),1000);return()=>clearTimeout(timer)},[decisionFeedback])
 const [zoom,setZoom]=useState(1)
 const [editingBox,setEditingBox]=useState(false)
 useEffect(()=>setEditingBox(false),[index,frameOffset,playerChoice])
 const inspectViewport=useRef<HTMLDivElement>(null)
 const [clickTargets,setClickTargets]=useState<{name:string;box:{x:number;y:number;width:number;height:number};borrowed:boolean}[]>([])
 const [focused,setFocused]=useState(true)
 const [pendingOnly,setPendingOnly]=useState(true)
 const openedQueue=useRef(false)
 const clipActive=useRef(false)
 const frame=useRef<HTMLVideoElement>(null),clip=useRef<HTMLVideoElement>(null),root=useRef<HTMLElement>(null),saving=useRef(false),cache=useRef(new Map<string,any>())
 const load=()=>api('/api/internal/lab-vision/workspace?job='+jobId+'&shots=1').then(setProject).catch(e=>setError(e.message))
 useEffect(()=>{void load()},[jobId])
 const shots=project?.shots??[],candidate=shots[index],aligned=Number.isFinite(project?.alignment?.offset),t=candidate&&aligned?candidate.sourceTime-project.alignment.offset:null
 const latest=detail.annotations.filter((a:any)=>!detail.annotations.some((b:any)=>b.supersedes===a.id)),saved=latest.find((a:any)=>a.candidateId===candidate?.id)
 useEffect(()=>{setShot(saved?.shot??candidate?.shot??'Unknown');setSide(saved?.side??'Unknown')},[candidate?.id,saved?.id])
 const hitter=playerChoice&&playerChoice.id===candidate?.id?playerChoice.name:saved?.player||detail.players.find((p:any)=>p.id===candidate?.playerId)?.name||''
 const choosePlayer=(name:string)=>{setPlayerChoice({id:candidate.id,name});setBox(null);setBoxNote('');boxEdited.current=false}
 const adjustBox=(value:any)=>{boxEdited.current=true;setBox(value);setBoxOrigin(boxOrigin==='human'?'human':'pose-adjusted');setBoxNote('Adjusted box')}
 const baseTime=saved?.confirmed||saved?.quickDecision?saved.time:t
 const at=baseTime===null?null:baseTime+frameOffset,valid=at!==null&&at>=0&&at<=detail.video.duration
 const done=(s:any)=>latest.some((a:any)=>a.candidateId===s?.id&&(a.status==='verified'||a.status==='excluded'||a.quickDecision==='shot'))
 const count=shots.filter(done).length
 const rejectedCount=shots.filter((s:any)=>latest.some((a:any)=>a.candidateId===s?.id&&a.status==='excluded')).length
 const pendingCount=shots.length-count
 const pendingIndices=shots.flatMap((s:any,i:number)=>!done(s)?[i]:[])
 const previousIndex=pendingOnly?[...pendingIndices].reverse().find((i:number)=>i<index):index>0?index-1:undefined
 const nextIndex=pendingOnly?pendingIndices.find((i:number)=>i>index):index<shots.length-1?index+1:undefined
 useEffect(()=>{if(project&&!openedQueue.current){openedQueue.current=true;const first=shots.findIndex((s:any)=>!done(s));if(first>=0)setIndex(first)}},[project])
 const start=valid?Math.max(0,at-1.5):0,end=valid?Math.min(detail.video.duration,at+1.5):0
 const move=(n:number)=>{if(saving.current)return;setFrameOffset(0);setIndex(Math.max(0,Math.min(shots.length-1,n)));setError('')}
 useEffect(()=>{
  setReady(false);setBox(null);setBoxNote('');setPlaying(false)
  if(clip.current){clip.current.pause();if(valid&&clip.current.readyState)clip.current.currentTime=Math.max(0,at-1.5)}
  if(valid&&frame.current?.readyState){frame.current.currentTime=at; if(Math.abs(frame.current.currentTime-at)<.001&&!frame.current.seeking)setReady(true)}
 },[index,at,correcting])
 useEffect(()=>{if(!correcting&&valid){root.current?.focus({preventScroll:true});replay()}return()=>{clipActive.current=false;clip.current?.pause()}},[index,correcting,baseTime])
 useEffect(()=>{let alive=true;boxEdited.current=false;setBox(null);setBoxNote('');setBoxOrigin('human')
  if(!valid||!hitter)return
  if(saved?.box&&saved.player===hitter&&Math.abs(saved.time-at)<.001&&boxRevision===0){setBox(saved.box);setBoxOrigin(saved.boxOrigin??'human');setBoxNote('Saved box');return}
  if(!detail.tracking){setBoxNote('No tracking · draw a box on the frame');return}
  const tr=detail.tracking,p=tr.manifest.players.find((p:any)=>p.name===hitter||p.id===detail.players.find((q:any)=>q.name===hitter)?.id),i=Math.floor(at/60)
  setBoxNote('Finding hitter…')
  Promise.all([i-1,i,i+1].filter(n=>n>=0&&n<tr.manifest.chunks).map(async n=>{const url=tr.assetBase+String(n).padStart(3,'0')+'.json';if(!cache.current.has(url))cache.current.set(url,await api(url));return cache.current.get(url)})).then(chunks=>{if(!alive||boxEdited.current)return;const b=p?proposeReviewBox(tr.manifest,chunks.flatMap(c=>c.poses??[]),at,p.key):null;setBox(b?.box??null);setBoxOrigin(b?'pose-proposal':'human');setBoxNote(b?(b.borrowed?'Nearby tracked box · check identity':'Tracked hitter'):'No reliable box · judge from the clip')}).catch(()=>{if(alive&&!boxEdited.current)setBoxNote('Tracking unavailable · judge from the clip')})
  return()=>{alive=false}
 },[index,at,hitter,boxRevision,correcting])
 useEffect(()=>{
  let alive=true;setClickTargets([])
  if(!valid||!detail.tracking)return
  const tr=detail.tracking,i=Math.floor(at/60)
  Promise.all([i-1,i,i+1].filter(n=>n>=0&&n<tr.manifest.chunks).map(async n=>{
   const url=tr.assetBase+String(n).padStart(3,'0')+'.json'
   if(!cache.current.has(url))cache.current.set(url,await api(url))
   return cache.current.get(url)
  })).then(chunks=>{
   if(!alive)return
   const poses=chunks.flatMap(c=>c.poses??[])
   setClickTargets(detail.players.flatMap((person:any)=>{
    const tracked=tr.manifest.players.find((p:any)=>p.id===person.id||p.name===person.name)
    const proposal=tracked?proposeReviewBox(tr.manifest,poses,at,tracked.key):null
    return proposal?[{name:person.name,box:proposal.box,borrowed:proposal.borrowed}]:[]
   }))
  }).catch(()=>{if(alive)setClickTargets([])})
  return()=>{alive=false}
 },[at,index,correcting,detail.tracking])
 useEffect(()=>{
  const viewport=inspectViewport.current
  if(!viewport)return
  const target=box??clickTargets.find(p=>p.name===hitter)?.box
  const x=target?target.x+target.width/2:.5,y=target?target.y+target.height/2:.5
  viewport.scrollTo({left:x*viewport.scrollWidth-viewport.clientWidth/2,top:y*viewport.scrollHeight-viewport.clientHeight/2})
 },[zoom,hitter])
 const replay=()=>{if(!valid||!clip.current)return;clipActive.current=true;clip.current.currentTime=start;void clip.current.play().catch(()=>{clipActive.current=false;setError('Press Space to start the preview; your browser blocked autoplay.')})}
 const step=(frames:number)=>{if(!valid)return;clipActive.current=false;clip.current?.pause();const next=Math.max(0,Math.min(detail.video.duration,at+frames/30));setFrameOffset(next-baseTime);if(clip.current)clip.current.currentTime=next}
 const decide=async(decision:string)=>{
  if(saving.current)return
  if(!valid||!ready){setError('Confirm video alignment and wait for the proposed frame to load.');return}
  if(saved?.status==='verified'){setError('This contact already has a verified annotation. Use V to revise it.');return}
  saving.current=true;setBusy(true);setError('');setDecisionFeedback({decision,phase:'saving'})
  try{
   const result=await api('/api/internal/lab-vision/workspace',{jobId,candidateId:candidate.id,supersedes:saved?.id??'',kind:'Shot contact',time:at,start,end,player:hitter,box:hitter?box:null,boxOrigin,shot,shotRole:shot==='Serve'?'Serve':(saved?.shotRole??candidate.role)==='Serve'?'Rally shot':saved?.shotRole??candidate.role,side,direction:saved?.direction??'Unknown',classificationReviewed:decision==='shot'&&shot!=='Unknown',notes:decision==='shot'?'Contact frame explicitly confirmed by approval in quick review. Player identity is not separately verified.':'Quick review: contact not approved.',status:decision==='not_contact'?'excluded':decision==='shot'?'verified':'needs_review',confirmed:decision==='shot',quickDecision:decision,scoutSource:{time:candidate.sourceTime,offset:project.alignment.offset,point:candidate.point}})
   onSaved(result.annotation);setDecisionFeedback({decision,phase:'saved'})
   clip.current?.pause()
   const remaining=shots.flatMap((s:any,i:number)=>i!==index&&!done(s)?[i]:[])
   const next=pendingOnly?(remaining.find((i:number)=>i>index)??remaining[0]):index<shots.length-1?index+1:undefined
   if(next!==undefined){setFrameOffset(0);setIndex(next)}
   setError(decision==='not_contact'?'Rejected · excluded from training and removed from pending.':decision==='uncertain'?'Saved as uncertain · remains pending.':next===undefined?'Saved. No pending proposals remain.':'Saved. Next pending proposal.')
  }catch(e){setDecisionFeedback(null);setError((e as Error).message)}finally{saving.current=false;setBusy(false)}
 }
 if(correcting)return <><div className="lv-controls"><button className="ui-btn" onClick={()=>{setCorrecting(false);void load()}}>← Back to Quick review</button><small>Corrections use the detailed editor. Exact timing is verified only when explicitly marked and approved.</small></div><ShotReview jobId={jobId} detail={detail} onSaved={onSaved} initialIndex={index}/></>
 if(!project)return <p role="status">{error||'Loading quick review…'}</p>
 return <section className={`lv-quick-review ${focused?'lv-quick-focused':''}`} ref={root} tabIndex={-1} onKeyDown={e=>{
  if((e.target as HTMLElement).closest('input,select,textarea')||e.ctrlKey||e.metaKey||e.altKey)return
  if(e.repeat&&!['z','c'].includes(e.key.toLowerCase()))return
  const k=e.key.toLowerCase(),stroke=strokeKeys.find(([,key])=>key.toLowerCase()===k)
  if(!stroke&&!['enter','r',' ','v','?','/','arrowleft','arrowright','z','c','[',']','0','i','o','k','l','+','=','-','b','escape'].includes(k))return;e.preventDefault()
  if(busy)return
  const playerIndex=['i','o','k','l'].indexOf(k)
  if(playerIndex>=0&&detail.players[playerIndex]){choosePlayer(detail.players[playerIndex].name);return}
  if(stroke){setShot(stroke[0]);return}
  if(k==='b'){if(hitter)setEditingBox(v=>!v);return}
  if(k==='escape'){setEditingBox(false);return}
  if(k==='+'||k==='='){setZoom(z=>Math.min(4,z+1));return}
  if(k==='-'){setZoom(z=>Math.max(1,z-1));return}
  if(k==='0'){setShot('Unknown');return}
  if(k==='z')step(e.shiftKey?-10:-1);if(k==='c')step(e.shiftKey?10:1);if(k==='enter')void decide('shot');if(k==='r')void decide('not_contact');if(k==='?'||k==='/')void decide('uncertain');if(k===' ')replay();if(k==='v')setCorrecting(true);if(k==='arrowleft')setSide('Backhand');if(k==='arrowright')setSide('Forehand');if(k==='['&&previousIndex!==undefined)move(previousIndex);if(k===']'&&nextIndex!==undefined)move(nextIndex)
 }}>
 <div className="lv-section-title"><h2>Quick review</h2><button className="ui-btn lv-focus-toggle" onClick={()=>setFocused(!focused)}>{focused?'Exit focus view':'Focus review'}</button><p>Which shot do you see? · Point {candidate?.point} · Proposal {index+1}/{shots.length}</p><progress value={count} max={shots.length}/><small>{count} reviewed · choose the stroke and side, then approve. Approve confirms the displayed contact frame. Player identity is optional.</small></div>
 {!aligned&&<div className="lv-note"><b>One-time alignment needed</b><p>The scout and uploaded video use different clocks. Confirm the first point’s start before reviewing proposals.</p><button className="ui-btn" onClick={()=>setCorrecting(true)}>Set video alignment · V</button></div>}
 <div className="lv-controls"><button className="ui-btn" onClick={()=>previousIndex!==undefined&&move(previousIndex)} disabled={busy||previousIndex===undefined}>← Previous</button><button className="ui-btn" disabled={busy||pendingCount===0} onClick={()=>{const n=shots.findIndex((s:any)=>!done(s));if(n>=0)move(n)}}>First pending</button><button className="ui-btn" onClick={()=>nextIndex!==undefined&&move(nextIndex)} disabled={busy||nextIndex===undefined}>Next →</button><span>{valid?clock(at):'Video alignment required'} · {saved?.status==='excluded'?'Rejected · not for training':saved?.quickDecision==='uncertain'?'Uncertain · pending':done(candidate)?'Approved':'Pending'}</span></div>
 <div className="lv-controls" aria-label="Review queue"><button className="ui-btn" aria-pressed={pendingOnly} data-variant={pendingOnly?'primary':'default'} onClick={()=>{setPendingOnly(true);const first=shots.findIndex((s:any)=>!done(s));if(first>=0)move(first)}}>Pending only · {pendingCount}</button><button className="ui-btn" aria-pressed={!pendingOnly} onClick={()=>setPendingOnly(false)}>All proposals</button><span>{count-rejectedCount} approved · {rejectedCount} rejected · {pendingCount} pending</span>{pendingOnly&&pendingCount===0&&<strong>Queue complete</strong>}</div>
 <div className="lv-controls lv-quick-players" aria-label="Select hitter"><b>Player</b>{detail.players.map((p:any,i:number)=><button key={p.id??p.name} className="ui-btn" aria-pressed={hitter===p.name} data-variant={hitter===p.name?'primary':'default'} disabled={busy} onClick={()=>choosePlayer(p.name)}>{p.name} <kbd>{['I','O','K','L'][i]}</kbd></button>)}<button className="ui-btn" disabled={busy} aria-pressed={!hitter} onClick={()=>choosePlayer('')}>Unknown</button>{hitter&&<button className="ui-btn" disabled={busy||!valid} onClick={()=>setBoxRevision(v=>v+1)}>Re-propose box</button>}</div>
 <div className="lv-quick-media">
 <article className="lv-card"><h3>Proposed frame · click a player to select</h3><div className="lv-controls" aria-label="Frame zoom">{[1,2,3,4].map(z=><button className="ui-btn" key={z} aria-pressed={zoom===z} data-variant={zoom===z?'primary':'default'} onClick={()=>setZoom(z)}>{z===1?'Fit':z+'×'}</button>)}<button className="ui-btn" disabled={!hitter||busy} aria-pressed={editingBox} data-variant={editingBox?'primary':'default'} onClick={()=>setEditingBox(v=>!v)}>{editingBox?'Done editing':'Edit box'} <kbd>B</kbd></button><span className="lv-inspect-hint">{editingBox?'Drag handles · Esc to finish':'+/− zoom · scroll to pan'}</span></div><div ref={inspectViewport} className="lv-quick-inspect"><div className="lv-video-frame" style={{width:zoom*100+'%'}}><video ref={frame} src={detail.video.url} preload="metadata" muted playsInline onLoadedMetadata={()=>{if(valid&&frame.current)frame.current.currentTime=at}} onSeeked={()=>setReady(!!frame.current&&valid&&Math.abs(frame.current.currentTime-at)<.05)} onLoadedData={()=>{if(valid&&frame.current&&!frame.current.seeking&&Math.abs(frame.current.currentTime-at)<.05)setReady(true)}}/>{valid&&ready&&hitter&&<PlayerBox hideLabel box={box} enabled={editingBox&&!busy} label={hitter} sourceLabel={boxNote} onChange={adjustBox}/>}{valid&&ready&&clickTargets.filter(p=>p.name!==hitter).map(p=><button key={p.name} type="button" className="lv-player-pick" aria-label={`Select ${p.name} in frame`} disabled={busy} style={{left:`${p.box.x*100}%`,top:`${p.box.y*100}%`,width:`${p.box.width*100}%`,height:`${p.box.height*100}%`}} onPointerDown={e=>e.stopPropagation()} onClick={()=>{choosePlayer(p.name);root.current?.focus({preventScroll:true})}} aria-description="Click to select this player" />)}</div></div><div className="lv-frame-caption">{hitter||'Select a player'}{hitter&&` · ${boxNote}`}</div><small>{valid?(boxNote+(editingBox?' · drag the box or its edges to adjust':' · B to edit box')):'Align the video to show this proposal.'}</small><div className="lv-controls"><button className="ui-btn" disabled={!valid||busy} onClick={()=>step(-1)}>−1 frame · Z</button><button className="ui-btn" disabled={!valid||busy} onClick={()=>step(1)}>+1 frame · C</button><small>Hold Z/C to keep stepping · Shift: 10 frames · steps assume 30 fps. V: detailed corrections.</small></div></article>
 <article className="lv-card"><h3>Watch the movement</h3><video ref={clip} src={detail.video.url} preload="metadata" muted playsInline controls onLoadedMetadata={()=>{if(valid)replay()}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={()=>{if(clipActive.current&&valid&&clip.current&&clip.current.currentTime>=end){clipActive.current=false;clip.current.pause();clip.current.currentTime=at}}}/><button className="ui-btn" disabled={!valid||busy} onClick={replay}>{playing?'Replay clip':'▶ Play 3-second clip'} <kbd>Space</kbd></button><small>Automatically plays 1.5 seconds before and after, then pauses at the proposed contact. Z/C adjusts the frame. Enter confirms that displayed frame as contact.</small></article>
 </div>
 <div className="lv-card lv-quick-keyboard" aria-label="Shot keyboard">
 <h3>Choose the shot</h3><div className="lv-stroke-keys">{strokeKeys.slice(0,9).map(([name,key])=><button key={name} className="ui-btn" aria-pressed={shot===name} data-variant={shot===name?'primary':'default'} disabled={busy} onClick={()=>setShot(name)}>{name}<kbd>{key}</kbd></button>)}</div>
 <div className="lv-controls">{strokeKeys.slice(12).map(([name,key])=><button key={name} className="ui-btn" aria-pressed={shot===name} data-variant={shot===name?'primary':'default'} disabled={busy} onClick={()=>setShot(name)}>{name}<kbd>{key}</kbd></button>)}<button className="ui-btn" disabled={busy} aria-pressed={shot==='Unknown'} onClick={()=>setShot('Unknown')}>Unknown <kbd>0</kbd></button></div>
 <details><summary>More shots{strokeKeys.slice(9,12).some(([name])=>name===shot)?' · '+shot:''}</summary><div className="lv-controls">{strokeKeys.slice(9,12).map(([name,key])=><button key={name} className="ui-btn" aria-pressed={shot===name} data-variant={shot===name?'primary':'default'} disabled={busy} onClick={()=>setShot(name)}>{name}<kbd>{key}</kbd></button>)}</div></details>
 <div className="lv-controls"><b>Side</b>{[['Backhand','←'],['Forehand','→'],['Unknown','']].map(([name,key])=><button key={name} className="ui-btn" aria-pressed={side===name} data-variant={side===name?'primary':'default'} disabled={busy} onClick={()=>setSide(name)}>{name} {key&&<kbd>{key}</kbd>}</button>)}</div>
 <p aria-live="polite">{shot} · {side} · Enter saves and advances</p>
 </div>
 <div className="lv-quick-actions">
 <div className="lv-decision-pair">
 <button className="ui-btn lv-decision" data-variant="primary" data-feedback={decisionFeedback?.decision==='shot'?decisionFeedback.phase:undefined} disabled={!valid||!ready||busy} onClick={()=>void decide('shot')}><span>{decisionFeedback?.decision==='shot'?(decisionFeedback.phase==='saving'?'Saving…':'✓ Approved'):'✓ Confirm contact & next'}</span><kbd>Enter</kbd></button>
 <button className="ui-btn lv-decision" data-variant="danger" data-feedback={decisionFeedback?.decision==='not_contact'?decisionFeedback.phase:undefined} disabled={!valid||!ready||busy} onClick={()=>void decide('not_contact')}><span>{decisionFeedback?.decision==='not_contact'?(decisionFeedback.phase==='saving'?'Saving…':'✓ Rejected'):'✕ Reject & next'}</span><kbd>R</kbd></button>
 </div>
 <button className="ui-btn" disabled={!valid||!ready||busy} onClick={()=>void decide('uncertain')}>Uncertain <kbd>?</kbd></button>
 <button className="ui-btn" disabled={busy} onClick={()=>setCorrecting(true)}>Correct details <kbd>V</kbd></button>
 </div><p className="lv-quick-status" role="status" aria-live="polite">{error}</p><p className="lv-note lv-quick-explainer">Original suggestion: <b>{candidate?.shot}</b> · {candidate?.reason}. Player and box are optional. I/O/K/L selects the hitter and proposes their box; drag to correct it. [ / ] changes proposal; ← / → chooses backhand / forehand.</p>
 </section>
}
