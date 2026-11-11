'use client'
import {useEffect,useRef,useState,type KeyboardEvent} from 'react'
import {proposeReviewBox} from '@/lib/lab-vision/propose-box'
import type {ScoutShot} from '@/lib/lab-vision/scouting-shots'
import PlayerBox,{type PlayerBoxValue} from './PlayerBox'
const clock=(n:number)=>n<0?'Before clip':new Date(n*1000).toISOString().slice(11,23)
async function request(url:string,body?:any){const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);return d}
export default function ShotReview({jobId,detail,onSaved,initialIndex=0}:{jobId:string;detail:any;onSaved:(a:any)=>void;initialIndex?:number}){
 const [project,setProject]=useState<any>(null),[error,setError]=useState(''),[selected,setSelected]=useState(0),[now,setNow]=useState(0),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const [player,setPlayer]=useState(''),[shot,setShot]=useState('Unknown'),[role,setRole]=useState('Unknown'),[side,setSide]=useState('Unknown'),[direction,setDirection]=useState('Unknown')
 const [contact,setContact]=useState<number|null>(null),[box,setBox]=useState<PlayerBoxValue|null>(null),[editing,setEditing]=useState(false),[boxOrigin,setBoxOrigin]=useState('human'),[boxMessage,setBoxMessage]=useState(''),[zoom,setZoom]=useState(1)
 const [boxLoading,setBoxLoading]=useState(false)
 const [reviewStep,setReviewStep]=useState(1)
 const root=useRef<HTMLElement>(null)
 const proposalVersion=useRef(0)
 useEffect(()=>()=>{proposalVersion.current++},[])
 const video=useRef<HTMLVideoElement>(null),stop=useRef<number|null>(null),cache=useRef(new Map<string,any>())
 useEffect(()=>{let alive=true;request('/api/internal/lab-vision/workspace?job='+jobId+'&shots=1').then(d=>{if(alive)setProject(d)}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[jobId])
 const shots:ScoutShot[]=project?.shots??[],candidate=shots[selected],offset=project?.alignment?.offset
 const aligned=Number.isFinite(offset),proposed=candidate&&aligned?candidate.sourceTime-offset:null
 const latest=detail.annotations.filter((a:any)=>!detail.annotations.some((b:any)=>b.supersedes===a.id))
 const saved=(id:string)=>latest.find((a:any)=>a.candidateId===id)
 const reviewed=shots.filter(s=>['verified','excluded'].includes(saved(s.id)?.status)).length
 const choose=(i:number)=>{
  const s=shots[i];if(!s)return
  proposalVersion.current++;setBoxLoading(false);const a=saved(s.id)
  setReviewStep(1);setSelected(i);setContact(a?.confirmed?a.time:null);setPlayer(a?.player??detail.players.find((p:any)=>p.id===s.playerId)?.name??'');setShot(a?.shot??s.shot);setRole(a?.shotRole??s.role);setSide(a?.side??'Unknown');setDirection(a?.direction??'Unknown');setBox(a?.box??null);setBoxOrigin(a?.boxOrigin??'human');setBoxMessage('');setEditing(false);setMessage('');stop.current=null
  if(aligned&&video.current){video.current.pause();video.current.currentTime=Math.max(0,Math.min(detail.video.duration,a?.time??s.sourceTime-offset))}
 }
 // Initialise proposal labels after loading; do not change them as the video plays.
 useEffect(()=>{if(project)choose(initialIndex)},[project?.matchId])
 const seek=(t:number)=>{const v=video.current;if(!v)return;stop.current=null;v.pause();v.currentTime=Math.max(0,Math.min(v.duration,t));setEditing(false)}
 const step=(n:number)=>seek((video.current?.currentTime??0)+n/30)
 const replay=()=>{if(proposed===null||!video.current)return;const t=contact??proposed;video.current.currentTime=Math.max(0,t-1.5);stop.current=Math.min(detail.video.duration,t+1.5);setEditing(false);void video.current.play().catch(e=>setMessage(e.message))}
 const mark=()=>{const v=video.current;if(!v||v.readyState<2)return;const t=v.currentTime;v.pause();stop.current=null;setNow(t);setReviewStep(2);setContact(t);setBox(null);setEditing(false);setMessage('Contact marked at '+clock(t)+'. Check the hitter box and stroke, then save.');void propose(t,player)}
 const nextPending=()=>{const i=shots.findIndex(s=>!['verified','excluded'].includes(saved(s.id)?.status));if(i>=0)choose(i)}
 const align=async()=>{const t=video.current?.currentTime;if(t===undefined)return;setBusy(true);try{const d=await request('/api/internal/lab-vision/workspace',{jobId,action:'align-shots',offset:project.firstStart-t,anchorVideoTime:t});setProject((p:any)=>({...p,alignment:d.alignment}));setMessage('Alignment saved. Check a later point too: pauses or edits can require a different alignment.')}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 const propose=async(t=contact,hitter=player)=>{
  const version=++proposalVersion.current
  setBoxLoading(false);setBox(null);setBoxOrigin('human');setEditing(false)
  if(t===null)return
  if(!hitter){setBoxMessage('Choose the hitter to automatically propose their box.');return}
  if(!detail.tracking){setBoxMessage('Tracking is unavailable. Draw the hitter box on the marked frame.');setEditing(true);return}
  setBoxLoading(true);setBoxMessage('Finding tracked hitter…')
  try{
   const tr=detail.tracking,p=tr.manifest.players.find((p:any)=>p.id===detail.players.find((q:any)=>q.name===hitter)?.id||p.name===hitter)
   const index=Math.floor(t/60),indices=[index-1,index,index+1].filter(i=>i>=0&&i<tr.manifest.chunks)
   const chunks=await Promise.all(indices.map(async i=>{const url=tr.assetBase+String(i).padStart(3,'0')+'.json';if(!cache.current.has(url))cache.current.set(url,await request(url));return cache.current.get(url)}))
   if(version!==proposalVersion.current)return
   const result=p?proposeReviewBox(tr.manifest,chunks.flatMap(c=>c.poses??[]),t,p.key):null
   setBox(result?.box??null);setBoxOrigin(result?'pose-proposal':'human')
   // Never rewind playback when an asynchronous proposal finishes.
   setEditing(false)
   setBoxMessage(result?(result.borrowed?'Nearby tracked frame: adjust to the marked contact.':'Tracked hitter box ready. Drag its edges to adjust.'):'No reliable nearby box. Draw around the hitter on the marked frame.')
  }catch(e){if(version===proposalVersion.current)setBoxMessage('Could not load tracking. You can draw the hitter box manually.')}
  finally{if(version===proposalVersion.current)setBoxLoading(false)}
 }
 const save=async(status:string)=>{
  if(!candidate||busy)return
  if(!aligned){setMessage('Save blocked: align the first point start using the button below (Shift+A). This is separate from marking contact.');return}
  if(boxLoading){setMessage('Wait for the hitter box to finish loading, then press Enter.');return}
  const t=contact??proposed!
  if(status==='verified'&&(contact===null||!player||shot==='Unknown')){setMessage('Mark the contact frame and choose the hitter and stroke first.');return}
  if(t<0||t>detail.video.duration){setMessage('This proposal falls outside the clip. Review the video alignment.');return}
  setBusy(true)
  try{const d=await request('/api/internal/lab-vision/workspace',{jobId,candidateId:candidate.id,supersedes:saved(candidate.id)?.id??'',kind:'Shot contact',time:t,start:Math.max(0,t-1.5),end:Math.min(detail.video.duration,t+1.5),player,shot,shotRole:role,side,direction,status,confirmed:contact!==null,notes:candidate.reason,box,boxOrigin,scoutSource:{time:candidate.sourceTime,offset,point:candidate.point}})
   onSaved(d.annotation);if(selected<shots.length-1)choose(selected+1);setMessage(status==='verified'?'Saved contact. Next proposal ready.':status==='excluded'?'Proposal rejected. Next proposal ready.':'Saved for further review.')
  }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}
 }
 const exportData=()=>{const payload={schemaVersion:1,project:{...project,shots:undefined},proposals:shots,annotations:latest.filter((a:any)=>a.candidateId?.startsWith('scout:')),timebase:'source-video-seconds',note:'Scouting taps are proposals; only verified annotations are reviewed contacts.'};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='all-shots-'+project.matchId+'.json';a.click();URL.revokeObjectURL(url)}

 const selectHitter=(index:number)=>{const name=detail.players[index]?.name;if(!name)return;setPlayer(name);setReviewStep(2);void propose(contact,name);root.current?.focus({preventScroll:true})}
 const keyButton=(label:string,key:string,active:boolean,action:()=>void)=><button type="button" className="ui-btn lv-key-button" data-variant={active?'primary':'default'} aria-pressed={active} onClick={action}><span>{label}</span><kbd>{key}</kbd></button>
 const editBox=()=>{
  if(contact===null){setMessage('Mark contact with V before editing a box.');return}
  proposalVersion.current++;setBoxLoading(false);seek(contact)
  if(!box){setBox({x:.4,y:.35,width:.12,height:.3});setBoxOrigin('human')}
  setEditing(!editing);root.current?.focus({preventScroll:true})
 }
 const keyboard=(e:KeyboardEvent<HTMLElement>)=>{
  const k=e.key.toLowerCase()
  if(k==='escape'){e.preventDefault();setEditing(false);root.current?.focus({preventScroll:true});return}
  if((e.target as HTMLElement).closest('input,select,textarea,[contenteditable]')||e.ctrlKey||e.metaKey||e.altKey)return
  const strokes:Record<string,string>={q:'Smash',w:'Volley',e:'Vibora',a:'Bandeja',s:'Groundstroke',d:'Lob',f:'Chiquita',g:'Block',h:'Bajada',t:'Gancho',y:'Rulo',u:'Contrapared',4:'Other'}
  const known=['z','c','j','i','o','k','l','home','insert','[',']','x','r','v','enter','n','pageup','pagedown','1','2','3','4','5','6','7','8','9','0','b','p','arrowleft','arrowright','arrowup','arrowdown','-','+','=','?']
  if(!known.includes(k)&&!strokes[k])return
  e.preventDefault()
  if(busy)return
  if(e.repeat&&!['z','c','j','l','arrowleft','arrowright','arrowup','arrowdown'].includes(k))return
  if(e.shiftKey&&k==='a'){void align();return}
  if(e.shiftKey&&k==='c'){step(10);return}
  if(k==='z'){step(e.shiftKey?-10:-1);return}
  if(k==='c'){step(1);return}
  if(k==='j'){step(e.shiftKey?30:-30);return}
  if(k==='insert'||k==='pageup'){step(k==='insert'?-150:150);return}
  if(['i','o','k','l'].includes(k)){selectHitter(['i','o','k','l'].indexOf(k));return}
  if(k==='x'||k==='home'){setEditing(false);stop.current=null;if(video.current?.paused)void video.current.play();else video.current?.pause();return}
  if(k==='r'){replay();return}
  if(k==='v'){mark();return}
  if(k==='enter'){void save('verified');return}
  if(k==='n'){void save(e.shiftKey?'needs_review':'excluded');return}
  if(k==='['||k===']'||k==='pagedown'){choose(Math.max(0,Math.min(shots.length-1,selected+(k===']'?1:-1))));return}
  if(k==='p'){nextPending();return}
  
  if(k==='5'){setReviewStep(2);setShot('Serve');setRole('Serve');setDirection('Cross-court');return}
  if(k==='6'){setReviewStep(2);setRole('Return of serve');return}
  if(k==='7'){setReviewStep(2);setRole('Rally shot');return}
  if(k==='8'){setDirection('Cross-court');return}
  if(k==='9'){setDirection('Down the line');return}
  if(k==='0'){setDirection('Middle');return}
  if(k==='b'){editBox();return}
  if(k==='+'||k==='='){setZoom(z=>Math.min(3,z+1));return}
  if(k==='-'){setZoom(z=>Math.max(1,z-1));return}
  if(k==='?'){setMessage('Shortcuts are listed below the video. Tab reaches all controls; Escape returns keyboard control to the video.');return}
  if(k.startsWith('arrow')){
   if(editing&&box&&contact!==null&&Math.abs(now-contact)<.05){
    const dx=k==='arrowleft'?-.002:k==='arrowright'?.002:0,dy=k==='arrowup'?-.002:k==='arrowdown'?.002:0
    proposalVersion.current++;setBoxLoading(false);setBoxOrigin(boxOrigin==='pose-proposal'?'pose-adjusted':boxOrigin)
    setBox(e.shiftKey?{...box,width:Math.max(.005,Math.min(1-box.x,box.width+dx)),height:Math.max(.005,Math.min(1-box.y,box.height+dy))}:{...box,x:Math.max(0,Math.min(1-box.width,box.x+dx)),y:Math.max(0,Math.min(1-box.height,box.y+dy))})
   }else if(k==='arrowleft')setSide('Backhand');else if(k==='arrowright')setSide('Forehand')
   return
  }
  if(strokes[k]){setReviewStep(2);setShot(strokes[k])}
 }
 if(error)return <p role="alert">{error}</p>
 if(!project)return <p role="status">Loading scouting proposals…</p>
 return <section ref={root} tabIndex={-1} onKeyDown={keyboard}>
 <div className="lv-section-title"><h2>Review every shot</h2><p>{project.points} points · {project.touches} operator taps + {shots.length-project.touches} point starts · {reviewed}/{shots.length} reviewed</p><progress max={shots.length} value={reviewed}/></div>
 <div className="lv-note">Scouting-seeded proposals, not model detections. Point starts may precede serve contact. Tap timing, player and stroke must be checked; reject duplicates and use Annotate & improve for missing contacts.</div>
 <details open={!aligned} className="lv-card"><summary>Video alignment · {aligned?'Anchor saved':'Required before reviewing'}</summary><p>Find the start of the first scouted point in this video, then confirm below. The scouting source clock is {clock(project.firstStart)}. This aligns point starts; mark actual contact separately.</p><button className="ui-btn" disabled={busy} onClick={()=>void align()}>Use current video time as first point start · Shift+A</button>{aligned&&<p>Video anchor {clock(project.alignment.anchorVideoTime)} · verify the alignment at later points before annotating them. Existing saved contacts keep their own times.</p>}</details>
 <div className="lv-controls"><label>Point <select value={candidate?.point??1} onChange={e=>choose(shots.findIndex(s=>s.point===Number(e.target.value)))}>{Array.from({length:project.points},(_,i)=><option key={i} value={i+1}>Point {i+1}</option>)}</select></label><button className="ui-btn" onClick={nextPending}>First pending</button><button className="ui-btn" onClick={exportData}>Export project</button></div>
 <div className="lv-annotation"><section className="lv-card">
 <div className="lv-controls">Inspect frame {[1,2,3].map(z=><button className="ui-btn" key={z} data-variant={zoom===z?'primary':'default'} onClick={()=>setZoom(z)}>{z===1?'Fit':z+'×'}</button>)}</div>
 <div style={{overflow:'auto',maxHeight:650}}><div className="lv-video-frame" style={{width:zoom*100+'%'}}><video ref={video} src={detail.video.url} controls={!editing} preload="metadata" onTimeUpdate={()=>{const v=video.current!;setNow(v.currentTime);if(stop.current!==null&&v.currentTime>=stop.current){v.pause();stop.current=null}}} onPlay={()=>setEditing(false)}/>
 {contact!==null&&Math.abs(now-contact)<.05&&<PlayerBox box={box} label={player} sourceLabel={boxOrigin==='pose-proposal'?'tracking proposal':boxOrigin==='pose-adjusted'?'adjusted tracking box':'manual box'} enabled={editing} onChange={b=>{proposalVersion.current++;setBoxLoading(false);setBox(b);setBoxOrigin(boxOrigin==='pose-proposal'?'pose-adjusted':boxOrigin)}}/>}
 </div></div>
 <div className="lv-controls"><button className="ui-btn" onClick={()=>{stop.current=null;setEditing(false);if(video.current?.paused)void video.current.play();else video.current?.pause()}}>Play / pause · X</button><button className="ui-btn" disabled={!aligned} onClick={replay}>Replay · R</button><b>{clock(now)}</b></div>
 <div className="lv-controls">{[-30,-10,-1,1,10,30].map(n=><button className="ui-btn" key={n} onClick={()=>step(n)}>{n>0?'+':''}{n} frame{Math.abs(n)>1?'s':''}</button>)}<button className="ui-btn" data-variant={contact!==null?'primary':'default'} onClick={mark}>{contact===null?'Mark contact · V':'✓ Contact '+clock(contact)}</button></div>
 <details className="lv-note"><summary>Keyboard shortcuts · Escape leaves a field or finishes box editing</summary>
 <p><b>Playback:</b> Home/X play/pause · Z/C ±1 frame · Shift+Z/C ±10 · J/Shift+J ±30 · R replay · V mark contact + propose box</p>
 <p><b>Hitter:</b> {detail.players.map((p:any,i:number)=><span key={p.id}>{['I','O','K','L'][i]} {p.name} · </span>)}</p>
 <p><b>Stroke:</b> Q smash · W volley · E víbora · A bandeja · S groundstroke · D lob · F chiquita · G block · H bajada · T gancho · Y rulo · U contrapared · 4 other</p>
 <p><b>Role:</b> 5 serve · 6 return of serve · 7 rally shot. <b>Side:</b> ← backhand / → forehand (exit box editing first). <b>Direction:</b> 8 cross-court · 9 down the line · 0 middle</p>
 <p><b>Box:</b> B edit/create · arrows move · Shift+arrows resize · Esc finish · +/− zoom. <b>Review:</b> Enter approve · N reject · Shift+N uncertain · [ / ] previous/next · Insert/Page Up ±5s · P first pending · Shift+A align first point start</p>
 <small>Shortcuts pause while typing or selecting a field. Escape returns to review. Frame steps assume 30 fps.</small></details>
 <div className="lv-shot-queue" aria-label="Point shot proposals">{shots.map((s,i)=>s.point===candidate?.point?<button className="ui-btn" key={s.id} aria-pressed={i===selected} data-variant={i===selected?'primary':'default'} onClick={()=>choose(i)}><b>{s.index===0?'Start':s.index+' · Tap'}</b><span>{s.playerName||'Choose server'}</span><small>{saved(s.id)?.status??s.shot}</small></button>:null)}</div>
 </section><section className="lv-card lv-form"><h3>Point {candidate?.point} · {candidate?.index===0?'Serve start proposal':'Touch '+candidate?.index}</h3><p>{candidate?.reason}</p><small>Scouting {clock(candidate?.sourceTime??0)} · Video proposal {proposed===null?'Align first':clock(proposed)}</small>

 <div className="lv-review-steps" aria-label="Review steps">{keyButton('1 · Contact & hitter','',reviewStep===1,()=>setReviewStep(1))}{keyButton('2 · Shot details','',reviewStep===2,()=>setReviewStep(2))}</div>
 <div className="lv-player-keys">{detail.players.map((p:any,i:number)=><div key={p.id}>{keyButton(p.name,['I','O','K','L'][i],player===p.name,()=>selectHitter(i))}</div>)}</div>
 <p className="lv-note">{contact===null?'Find the contact frame. Press V to mark it and propose the hitter box.':'✓ Contact '+clock(contact)+' · '+(player||'Choose the hitter')}</p>
 {reviewStep===1?<div className="lv-step-prompt"><p>Home / X to play · Z / C to step frames.</p>{keyButton('Mark contact & continue','V',false,mark)}<p>Select a player with I / O / K / L to open shot details.</p></div>:<div className="lv-shot-details">
 <div className="lv-controls">{keyButton('Serve','5',role==='Serve',()=>{setShot('Serve');setRole('Serve');setDirection('Cross-court')})}{keyButton('Return of serve','6',role==='Return of serve',()=>setRole('Return of serve'))}{keyButton('Rally shot','7',role==='Rally shot',()=>setRole('Rally shot'))}</div>
 <h4>Shot</h4><div className="lv-stroke-keys">{[['Smash','Q'],['Volley','W'],['Vibora','E'],['Bandeja','A'],['Groundstroke','S'],['Lob','D'],['Chiquita','F'],['Block','G'],['Bajada','H']].map(([name,key])=><div key={name}>{keyButton(name,key,shot===name,()=>setShot(name))}</div>)}</div>
 <details><summary>More shots{['Gancho','Rulo','Contrapared','Other'].includes(shot)?' · '+shot:''}</summary><div className="lv-stroke-keys">{[['Gancho','T'],['Rulo','Y'],['Contrapared','U'],['Other','4'],['Unknown','']].map(([name,key])=><div key={name}>{keyButton(name,key,shot===name,()=>setShot(name))}</div>)}</div></details>
 <h4>Side</h4><div className="lv-controls">{keyButton('Backhand','←',side==='Backhand',()=>setSide('Backhand'))}{keyButton('Forehand','→',side==='Forehand',()=>setSide('Forehand'))}{keyButton('Unknown','',side==='Unknown',()=>setSide('Unknown'))}</div>
 <h4>Direction</h4><div className="lv-controls">{[['Cross-court','8'],['Down the line','9'],['Middle','0'],['Unknown','']].map(([name,key])=><span key={name}>{keyButton(name,key,direction===name,()=>setDirection(name))}</span>)}</div>
 </div>}
 <details><summary>Adjust hitter box · B</summary><button className="ui-btn" disabled={contact===null||!player||boxLoading} onClick={()=>{if(contact!==null)seek(contact);void propose()}}>{boxLoading?'Finding hitter box…':'Refresh hitter box'}</button><button className="ui-btn" disabled={contact===null} onClick={editBox}>{editing?'Done editing box · Esc':'Draw / adjust box · B'}</button><p role="status" aria-live="polite">{boxMessage}</p></details>
 <p role="status" aria-live="polite">{message}</p>
 {!aligned&&<div className="lv-note" role="status"><b>Before saving: confirm video alignment</b><p>Find the start of the first scouted point, then press Shift+A. Marking contact with V does not align the video. Do not use the contact frame unless it is also the point start.</p><button className="ui-btn" disabled={busy} onClick={()=>void align()}>Align first point to current video time · Shift+A</button></div>}
 {editing&&<small>Box editing: arrows move · Shift+arrows resize · Escape finishes. Outside box editing, ← backhand / → forehand.</small>}
 <button className="ui-btn" data-variant="primary" disabled={busy||boxLoading} onClick={()=>void save('verified')}>{busy?'Saving…':'Approve contact & next · Enter'}</button><button className="ui-btn" disabled={busy||boxLoading} onClick={()=>void save('excluded')}>Reject duplicate / not a contact · N</button><button className="ui-btn" disabled={busy||boxLoading} onClick={()=>void save('needs_review')}>Uncertain & next · Shift+N</button>
 <small>Verified contacts are human labels, not automatic training. Original scout timestamps remain in the export.</small>
 </section></div></section>
}
