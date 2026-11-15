'use client';
import {useState} from 'react';
export type VideoChapter={label:string;start:number};
export type VideoMarker={label:string;start:number;end:number};
const stamp=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
export default function VideoChapters({chapters,markers,markerLabel,time,duration,onSeek}:{chapters:VideoChapter[];markers:VideoMarker[];markerLabel:string;time:number;duration:number;onSeek:(time:number)=>void}){
 const [hover,setHover]=useState<number|null>(null);
 const total=Number.isFinite(duration)&&duration>0?duration:0;
 const sections=chapters.filter(c=>c.start>=0&&c.start<total).sort((a,b)=>a.start-b.start);
 if(sections.length&&sections[0].start>0)sections.unshift({label:'Pre-match',start:0});
 const current=sections.filter(c=>c.start<=time+.05).at(-1);
 const visible=markers.filter(m=>m.start>=0&&m.start<total);
 return <div className="vr-video-chapters">
 <div className="vr-chapter-labels" aria-label="Match chapters">{sections.map((c,i)=><button className="ui-btn" key={c.start} aria-current={current===c?'true':undefined} title={`${c.label} · ${stamp(c.start)}`} style={{flex:(sections[i+1]?.start??total)-c.start}} onClick={()=>onSeek(c.start)}>{c.label}</button>)}</div>
 <div className="vr-chapter-seek" onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*total)}} onPointerLeave={()=>setHover(null)}>
 <div className="vr-chapter-segments" aria-hidden="true">{(sections.length?sections:[{label:'Video',start:0}]).map((c,i)=>{const end=sections[i+1]?.start??total,progress=Math.max(0,Math.min(100,(time-c.start)/(end-c.start)*100));return <span key={c.start} style={{flex:end-c.start,background:`linear-gradient(to right,#c6f52d ${progress}%,#ffffff55 ${progress}%)`}}/>})}</div>
 <input type="range" aria-label="Video seek" aria-valuetext={`${stamp(time)}${current?`, ${current.label}`:''}`} min={0} max={total} step={0.033333} disabled={!total} value={Math.min(time,total)} onChange={e=>onSeek(Number(e.target.value))}/>
 {hover!==null&&<span className="vr-chapter-tooltip" style={{left:`${Math.max(12,Math.min(88,hover/(total||1)*100))}%`}}>{sections.filter(c=>c.start<=hover).at(-1)?.label} · {stamp(hover)}</span>}
 </div>
 {markerLabel&&<div className="vr-chapter-events"><div className="vr-chapter-marker-track" title="Click near a marker to jump to that moment" aria-hidden="true" onClick={e=>{const r=e.currentTarget.getBoundingClientRect(),t=(e.clientX-r.left)/r.width*total,nearest=visible.reduce<VideoMarker|null>((a,b)=>!a||Math.abs(b.start-t)<Math.abs(a.start-t)?b:a,null);if(nearest)onSeek(nearest.start)}}>{visible.map((m,i)=><i key={i} style={{left:`${m.start/(total||1)*100}%`,width:`${Math.max(.2,(m.end-m.start)/(total||1)*100)}%`}}/>)}</div><span>{visible.length} {markerLabel}</span></div>}
 </div>;
}
