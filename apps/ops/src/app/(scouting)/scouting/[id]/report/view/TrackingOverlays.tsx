'use client';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {AnalysisResult} from '@/lib/scouting/use-analysis-result';
import {useTrackingWindow} from '@/lib/scouting/use-tracking-window';
import {pairMetrics,positionAt,projectCourt,speedAt,trailAt,type XY} from '@/lib/scouting/tracking-overlay';
import {syncVideoFrames} from '@/lib/scouting/video-frame-sync';
import './tracking-overlays.css';
const colors=['#ffc247','#c6f70e'];
const teamColor=(team:number)=>colors[team%colors.length];
function Tag({at,text,color='#fff'}:{at:XY;text:string;color?:string}){
 const width=text.length*6.5+14;
 return <g transform={`translate(${at[0]},${at[1]})`}><rect x={-width/2} y={-11} width={width} height={22} rx={5} fill="#101917" fillOpacity=".9"/><text textAnchor="middle" dominantBaseline="central" fill={color} fontSize="11" fontFamily="system-ui,sans-serif">{text}</text></g>;
}
export default function TrackingOverlays({result,video}:{result:AnalysisResult;video:RefObject<HTMLVideoElement|null>}){
 const [mode,setMode]=useState<'off'|'positioning'|'movement'>('off');
 const [selection,setSelection]=useState('all'),[customize,setCustomize]=useState(false);
 const [net,setNet]=useState(false),[names,setNames]=useState(true),[trails,setTrails]=useState(true);
 const [time,setTime]=useState(0),[paused,setPaused]=useState(true);
 const [host,setHost]=useState<HTMLElement|null>(null),[box,setBox]=useState({width:0,height:0});
 const last=useRef(-1),panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=panel.current,parent=el?.parentElement;if(!el||!parent)return;const measure=()=>parent.style.setProperty('--tracking-panel-height',el.offsetHeight+'px');measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>{observer.disconnect();parent.style.removeProperty('--tracking-panel-height');};},[]);
 useEffect(()=>{const v=video.current;if(!v)return;const el=v.parentElement!;setHost(el);
  const measure=()=>setBox({width:el.clientWidth,height:el.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(el);
  const state=()=>{setPaused(v.paused);setTime(v.currentTime);};state();v.addEventListener('play',state);v.addEventListener('pause',state);
  const stop=syncVideoFrames(v,t=>{if(v.paused||Math.abs(t-last.current)>=1/30){last.current=t;setTime(t);}});
  return()=>{stop();observer.disconnect();v.removeEventListener('play',state);v.removeEventListener('pause',state);};
 },[video]);
 const tracking=useTrackingWindow(result,time,mode!=='off');
 const players=result.manifest.players;
 const selected=players.filter(p=>selection==='all'||selection===p.key||selection===`team:${p.team}`);
 const current=selected.map(p=>({...p,xy:positionAt(tracking.rows,time,p.key)}));
 const teams=[...new Set(players.map(p=>p.team))];
 const pairs=teams.map(team=>current.filter(p=>p.team===team)).filter(ps=>ps.length===2&&ps.every(p=>p.xy));
 const dims=tracking.manifest?.sourceDimensions;
 const calibrated=!!dims&&dims.length===2&&dims.every(n=>Number.isFinite(n)&&n>0)&&!!tracking.manifest&&!!projectCourt([5,10],tracking.manifest);
 const scale=calibrated?Math.min(box.width/dims![0],box.height/dims![1]):0;
 const offset:XY=calibrated?[(box.width-dims![0]*scale)/2,(box.height-dims![1]*scale)/2]:[0,0];
 function project(xy:XY):XY|null{const p=tracking.manifest&&projectCourt(xy,tracking.manifest);return p?[p[0]*scale+offset[0],p[1]*scale+offset[1]]:null;}
 function line(a:XY,b:XY,color:string,dashed=false){const from=project(a),to=project(b);return from&&to?<line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color} strokeWidth={1.5} strokeDasharray={dashed?'4 4':undefined}/>:null;}
 const hasPositions=current.some(p=>p.xy);
 const status=tracking.error|| (tracking.loading?'Loading saved tracking…':!hasPositions?'No reliable tracking at this moment.':!calibrated?'Video calibration unavailable. Court view remains available.':'');
 return <>
 {mode!=='off'&&host&&createPortal(<div className="tracking-video-layer" aria-hidden="true">{calibrated&&<svg width="100%" height="100%" viewBox={`0 0 ${box.width||1} ${box.height||1}`}>
 {mode==='positioning'&&pairs.map(pair=>{const [a,b]=pair,mid=project([(a.xy![0]+b.xy![0])/2,(a.xy![1]+b.xy![1])/2]);return <g key={a.team}>{line(a.xy!,b.xy!,teamColor(a.team))}{mid&&<Tag at={[mid[0],mid[1]+15]} text={`${pairMetrics(a.xy!,b.xy!).spacing.toFixed(1)} m`}/>}</g>;})}
 {current.map(p=>{if(!p.xy)return null;const at=project(p.xy);if(!at)return null;const color=teamColor(p.team),netPoint:XY=[p.xy[0],10],netAt=project(netPoint),trail=mode==='movement'&&trails?trailAt(tracking.rows,time,p.key):[];
 return <g key={p.key}>{trail.slice(1).map((q,i)=><g key={q.time} opacity={.15+.7*(i+1)/trail.length}>{line(trail[i].xy,q.xy,color)}</g>)}
 {mode==='positioning'&&(net||paused)&&netAt&&<>{line(p.xy,netPoint,color,true)}<Tag at={[(at[0]+netAt[0])/2+22,(at[1]+netAt[1])/2]} text={`Net ${Math.abs(p.xy[1]-10).toFixed(1)} m`}/></>}
 <ellipse cx={at[0]} cy={at[1]} rx={11} ry={4} fill="none" stroke={color} strokeWidth={2}/>{names&&<Tag at={[Math.max((p.shortName??p.name).length*3.25+8,Math.min(box.width-(p.shortName??p.name).length*3.25-8,at[0])),Math.min(box.height-15,at[1]+25)]} text={p.shortName??p.name} color={color}/>}</g>;})}
 </svg>}<span className="tracking-badge">{paused?'Paused review':'Tracking'} · observed positions</span></div>,host)}
 <div className="tracking-panel" ref={panel}><div className="tracking-controls" aria-label="Tracking overlays">
 <div role="group" aria-label="Overlay mode">{(['off','positioning','movement'] as const).map(value=><button key={value} className="ui-btn" data-variant={mode===value?'primary':'default'} aria-pressed={mode===value} onClick={()=>setMode(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
 {mode!=='off'&&<><select className="ui-input" aria-label="Overlay players" value={selection} onChange={e=>setSelection(e.target.value)}><option value="all">All players</option>{teams.map(team=><option key={team} value={`team:${team}`}>{players.filter(p=>p.team===team).map(p=>p.shortName??p.name).join(' / ')}</option>)}{players.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}</select><button className="ui-btn" aria-expanded={customize} onClick={()=>setCustomize(!customize)}>Customize</button></>}
 </div>
 {mode!=='off'&&customize&&<div className="tracking-options"><label><input type="checkbox" checked={names} onChange={e=>setNames(e.target.checked)}/>Player names</label>{mode==='positioning'?<label><input type="checkbox" checked={net} onChange={e=>setNet(e.target.checked)}/>Net distances while playing</label>:<label><input type="checkbox" checked={trails} onChange={e=>setTrails(e.target.checked)}/>Trails · last 2 seconds</label>}<small>Additional positioning measurements appear when paused.</small></div>}
 {mode!=='off'&&<div className="tracking-readout">{status&&<span role="status">{status} {tracking.error&&<button className="ui-btn" onClick={tracking.retry}>Retry</button>}</span>}
 {mode==='movement'&&current.map(p=>{const speed=speedAt(tracking.rows,time,p.key);return <span key={p.key}><i style={{background:teamColor(p.team)}}/>{p.name} <strong>{speed==null?'—':`${speed.toFixed(1)} km/h`}</strong></span>;})}
 {mode==='positioning'&&paused&&pairs.map(([a,b])=>{const m=pairMetrics(a.xy!,b.xy!);return <span key={a.team}>{a.name} / {b.name} · <strong>{m.spacing.toFixed(1)} m apart</strong> · depth difference <strong>{m.depth.toFixed(1)} m</strong></span>;})}
 <small>{mode==='movement'?'Speed: 1-second displacement. Gaps are unavailable, not zero. ':'Distances measured on the court floor. '}Player identities after cuts may need review.</small></div>}
 </div></>;
}

export function TrackingCourt2D({result,time}:{result:AnalysisResult;time:number}){
 const {rows,loading,error,retry}=useTrackingWindow(result,time);
 const players=result.manifest.players.map(p=>({...p,xy:positionAt(rows,time,p.key)}));
 const point=(xy:XY):XY=>[30+xy[0]*12,20+xy[1]*12];
 return <div className="tracking-court-2d"><svg viewBox="0 0 180 280" role="img" aria-label="2D court showing observed player positions">
 <rect x="30" y="20" width="120" height="240" rx="1" fill="#1467a9" stroke="white"/><path d="M30 56 L150 56 M30 224 L150 224 M90 56 L90 224" stroke="white" strokeWidth="1" fill="none"/><path d="M27 140 L153 140" stroke="white" strokeWidth="2"/>
 {[...new Set(players.map(p=>p.team))].map(team=>{const ps=players.filter(p=>p.team===team);if(ps.length!==2||!ps[0].xy||!ps[1].xy)return null;const a=point(ps[0].xy),b=point(ps[1].xy);return <line key={team} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={teamColor(team)} strokeWidth="1.5"/>;})}
 {players.map(p=>{if(!p.xy)return null;const [x,y]=point(p.xy);return <g key={p.key}><circle cx={x} cy={y} r="4" fill={teamColor(p.team)}/><text x={x} y={y-8} textAnchor="middle" fill="white" fontSize="6">{p.shortName??p.name}</text></g>;})}</svg>
 {(loading||error||!players.some(p=>p.xy))&&<p role="status">{error|| (loading?'Loading tracking…':'No reliable tracking at this moment.')}{error&&<button className="ui-btn" onClick={retry}>Retry</button>}</p>}
 <small>Observed positions · identities may need review</small></div>;
}
