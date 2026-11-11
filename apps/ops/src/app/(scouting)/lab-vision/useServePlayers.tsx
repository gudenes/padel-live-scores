'use client'
import {useEffect,useRef,useState} from 'react'
import PlayerBox,{type PlayerBoxValue} from './PlayerBox'
import {proposeReviewBox} from '@/lib/lab-vision/propose-box'
export type ServeParticipant={player:string;role:string;box:PlayerBoxValue|null;visibility:string;sourceFrameTime?:number|null}
export function useServePlayers(detail:any,time:number,now:number,selected:any,server:string,setServer:(p:string)=>void,invalidate:()=>void,pause:()=>void,focusBox:(b:PlayerBoxValue|null)=>void){
 const [receiver,setReceiver]=useState(''),[boxes,setBoxes]=useState<Record<string,PlayerBoxValue|null>>({}),[hidden,setHidden]=useState<string[]>([]),[active,setActive]=useState(''),[edit,setEdit]=useState(false),[mode,setMode]=useState<'server'|'receiver'|'edit'>('server'),[status,setStatus]=useState('')
 const [sources,setSources]=useState<Record<string,number>>({})
 const original=useRef<PlayerBoxValue|null>(null)
 const beginEdit=(name:string)=>{pause();setActive(name);original.current=boxes[name]??null;setEdit(true);setMode('edit');focusBox(boxes[name]??null)}
 const cache=useRef(new Map<string,Promise<any>>())
 const players=detail.players as {name:string;id:string}[]
 const team=(name:string)=>Math.floor(players.findIndex(p=>p.name===name)/2)
 const role=(name:string)=>name===server?'Server':name===receiver?'Receiver':server&&team(name)===team(server)?'Server’s partner':receiver&&team(name)===team(receiver)?'Receiver’s partner':'Choose role'
 useEffect(()=>{setReceiver(selected?.savedParticipants?.find((p:ServeParticipant)=>p.role==='Receiver')?.player??'');setHidden(selected?.savedParticipants?.filter((p:ServeParticipant)=>p.visibility==='not_visible').map((p:ServeParticipant)=>p.player)??[]);setMode('server')},[selected])
 useEffect(()=>{
  setEdit(false);setActive('');setBoxes({});setSources({});if(!selected)return
  let alive=true
  const saved=selected.savedParticipants
  if(saved&&Math.abs(time-selected.savedTime)<1/60){setBoxes(Object.fromEntries(saved.map((p:ServeParticipant)=>[p.player,p.box])));setSources(Object.fromEntries(saved.filter((p:ServeParticipant)=>p.sourceFrameTime!=null).map((p:ServeParticipant)=>[p.player,p.sourceFrameTime])));setStatus('Saved boxes restored.');return}
  setHidden([])
  const tracking=detail.tracking
  if(!tracking){setStatus('Tracking unavailable. Draw boxes manually.');return}
  setStatus('Finding four player boxes…')
  const m=tracking.manifest,idx=Math.floor(time/(m.chunkSeconds||60))
  Promise.all([idx-1,idx,idx+1].filter(i=>i>=0&&i<m.chunks).map(i=>{
   const url=tracking.assetBase+String(i).padStart(3,'0')+'.json'
   if(!cache.current.has(url))cache.current.set(url,fetch(url).then(r=>{if(!r.ok)throw Error();return r.json()}).catch(e=>{cache.current.delete(url);throw e}))
   return cache.current.get(url)!
  })).then(chunks=>{
   if(!alive)return
   const poses=chunks.flatMap(c=>c.poses??[]),result:Record<string,PlayerBoxValue|null>={}
   const sourceTimes:Record<string,number>={}
   players.forEach(p=>{const identity=m.players.find((x:any)=>x.id===p.id||x.name===p.name);const proposal=identity?proposeReviewBox(m,poses,time,identity.key):null;result[p.name]=proposal?.box??null;if(proposal?.borrowed)sourceTimes[p.name]=proposal.sampleTime})
   setSources(sourceTimes)
   setBoxes(result);const count=Object.values(result).filter(Boolean).length;setStatus(count?count+' / 4 boxes proposed. Check identities and edges.':'Contact frame has no reliable saved tracking. Click a player’s Draw missing box label, then drag around them in the video. No need to mark the contact again.')
  }).catch(()=>{if(alive)setStatus('Could not load poses. Draw boxes manually.')})
  return()=>{alive=false}
 },[selected,time,detail.source?.jobId])
 useEffect(()=>{if(receiver&&team(receiver)===team(server))setReceiver('')},[server])
 useEffect(()=>{if(Math.abs(now-time)>.05)setEdit(false)},[now,time])
 const assign=(name:string)=>{pause();invalidate();setActive(name);setEdit(false);if(mode==='server'){setServer(name);if(team(receiver)===team(name))setReceiver('');setMode('receiver')}else if(team(name)!==team(server)){setReceiver(name);setMode('edit')}else setStatus('Choose the receiver from the opposing team.')}
 const participants:ServeParticipant[]=players.map(p=>({player:p.name,role:role(p.name),box:hidden.includes(p.name)?null:boxes[p.name]??null,sourceFrameTime:sources[p.name]??null,visibility:hidden.includes(p.name)?'not_visible':boxes[p.name]?'visible':'unmarked'}))
 const ready=!!server&&!!receiver&&team(server)!==team(receiver)&&participants.every(p=>p.visibility!=='unmarked')
 const overlay=selected&&Math.abs(now-time)<.05&&<div className="lv-four-players">
  {players.map(p=>{const b=boxes[p.name];return b&&!hidden.includes(p.name)&&!edit?<button key={p.name} className="lv-role-box" title={mode==='edit'?'Click to adjust this box':'Select '+mode} aria-label={p.name+' · '+role(p.name)} onClick={()=>mode==='edit'?beginEdit(p.name):assign(p.name)} style={{left:b.x*100+'%',top:b.y*100+'%',width:b.width*100+'%',height:b.height*100+'%'}}><span>{p.name}<br/>{role(p.name)}{sources[p.name]!=null&&<><br/>Nearby frame {(sources[p.name]-time)>=0?'+':''}{(sources[p.name]-time).toFixed(2)} s · adjust</>}</span></button>:null})}
  {edit&&<PlayerBox box={boxes[active]??null} label={active} sourceLabel={role(active)} enabled onChange={b=>{setBoxes(prev=>({...prev,[active]:b}));setHidden(h=>h.filter(n=>n!==active));invalidate()}}/>}
 </div>
 const controls=selected&&<div className="lv-role-review">
  <div className="lv-controls"><button className="ui-btn" data-variant={mode==='server'?'primary':'default'} onClick={()=>{setMode('server');setEdit(false)}}>1 · Select server</button><button className="ui-btn" data-variant={mode==='receiver'?'primary':'default'} onClick={()=>{setMode('receiver');setEdit(false)}}>2 · Select receiver</button><button className="ui-btn" data-variant={mode==='edit'?'primary':'default'} onClick={()=>{setMode('edit');setEdit(false)}}>3 · Edit boxes</button></div>
  {edit&&<div className="lv-edit-toolbar"><strong>Adjusting {active}</strong><small>Drag inside to move · drag a corner or edge to resize. Include head, hands and shoes.</small><div className="lv-controls"><button className="ui-btn" onClick={()=>{setBoxes(b=>({...b,[active]:null}));invalidate()}}>Redraw box</button><button className="ui-btn" onClick={()=>{setBoxes(b=>({...b,[active]:original.current}));invalidate()}}>Restore box</button><button className="ui-btn" data-variant="primary" onClick={()=>setEdit(false)}>Done adjusting player</button></div></div>}
  {Object.keys(sources).length>0&&<div className="lv-note">Nearby-frame suggestions (within 1 second): adjust each to match the displayed contact frame. These are starting boxes, not tracked positions at contact; check camera view and identity.</div>}
  <p role="status">{status} {mode==='edit'?'Click any player box in the video to adjust it.':'Click a player box to select the '+mode+'. Partners are assigned from teams.'}</p>
  {Math.abs(now-time)>.05&&<small>Confirm contact here to propose boxes on the current frame.</small>}
  <div className="lv-role-list">{participants.map(p=><div key={p.player}><button className="ui-btn" onClick={()=>!p.box||mode==='edit'?beginEdit(p.player):assign(p.player)}>{p.player} · {p.role}{!p.box&&p.visibility!=='not_visible'?' · Draw missing box':''}</button><label><input type="checkbox" checked={p.visibility==='not_visible'} onChange={e=>{setHidden(h=>e.target.checked?[...h,p.player]:h.filter(n=>n!==p.player));invalidate()}}/> Not visible</label></div>)}</div>

 </div>
 return {overlay,controls,participants,ready,isEditing:edit,changeMode:(m:'server'|'receiver'|'edit')=>{setMode(m);setEdit(false)}}
}
