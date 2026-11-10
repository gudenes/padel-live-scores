'use client'
import {useRef,useState,type PointerEvent} from 'react'
export type PlayerBoxValue={x:number;y:number;width:number;height:number}
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v))
export default function PlayerBox({box,onChange,label,enabled}:{box:PlayerBoxValue|null;onChange:(b:PlayerBoxValue|null)=>void;label:string;enabled:boolean}){
 const root=useRef<HTMLDivElement>(null)
 const gesture=useRef<{id:number;x:number;y:number;box:PlayerBoxValue|null;mode:string}|null>(null)
 const [dragging,setDragging]=useState(false)
 const point=(e:PointerEvent)=>{const r=root.current!.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width),y:clamp((e.clientY-r.top)/r.height)}}
 const down=(e:PointerEvent,mode:string)=>{if(!enabled||e.button!==0)return;e.preventDefault();e.stopPropagation();const p=point(e);gesture.current={id:e.pointerId,...p,box,mode};root.current!.setPointerCapture(e.pointerId);setDragging(true)}
 const move=(e:PointerEvent)=>{const g=gesture.current;if(!g)return;const p=point(e),dx=p.x-g.x,dy=p.y-g.y,b=g.box
 if(g.mode==='draw'){onChange({x:Math.min(g.x,p.x),y:Math.min(g.y,p.y),width:Math.abs(dx),height:Math.abs(dy)});return}
 if(!b)return
 if(g.mode==='move'){onChange({...b,x:clamp(b.x+dx,0,1-b.width),y:clamp(b.y+dy,0,1-b.height)});return}
 let l=b.x,t=b.y,r=b.x+b.width,bt=b.y+b.height
 if(g.mode.includes('w'))l=clamp(b.x+dx,0,r-.005)
 if(g.mode.includes('e'))r=clamp(b.x+b.width+dx,l+.005,1)
 if(g.mode.includes('n'))t=clamp(b.y+dy,0,bt-.005)
 if(g.mode.includes('s'))bt=clamp(b.y+b.height+dy,t+.005,1)
 onChange({x:l,y:t,width:r-l,height:bt-t})}
 const finish=()=>{gesture.current=null;setDragging(false);if(box&&(box.width<.005||box.height<.005))onChange(null)}
 return <div ref={root} className={`lv-box-layer ${enabled?'editing':''}`} aria-label="Player bounding box canvas" onPointerDown={e=>down(e,'draw')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
 {box&&<div className="lv-player-box" style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`}} onPointerDown={e=>down(e,'move')}><span className="lv-box-label">{label||'Select player'} · manual box</span>{enabled&&['nw','n','ne','e','se','s','sw','w'].map(h=><span key={h} className={`lv-box-handle ${h}`} onPointerDown={e=>down(e,h)}/>)}</div>}
 {enabled&&!box&&!dragging&&<span className="lv-box-hint">Drag a box around the player</span>}
 </div>
}
