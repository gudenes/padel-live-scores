'use client';
import {useEffect,useRef,useState,useId,type RefObject,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import type {AnalysisResult} from '@/lib/scouting/use-analysis-result';
import {useTrackingWindow} from '@/lib/scouting/use-tracking-window';
import {groundRing,pairMetrics,positionAt,projectCourt,speedAt,trailAt,type XY} from '@/lib/scouting/tracking-overlay';
import {syncVideoFrames} from '@/lib/scouting/video-frame-sync';
import {OverlayOff,TeamShape,MovementTrail,PlayerGroup,OverlaySettings,NetDistance,PairConnection,PressureGauge,ArrowLeft,ArrowRight} from './Icons';
import {COURT_ZONES,supportsCourtZones} from '@/lib/scouting/court-zones';
import {rallyAt,rallyPressure,type RallyWindow} from '@/lib/scouting/rally-pressure';
import {assessPair,PAIR_COLORS} from '@/lib/scouting/pair-position-rules';
import {useTrackingRules,TrackingRuleControls} from './TrackingRules';
import './tracking-overlays.css';
function ToolbarHelp(){
 const anchor=useRef<HTMLSpanElement>(null),[help,setHelp]=useState('');
 useEffect(()=>{const root=anchor.current?.parentElement;if(!root)return;
 const show=(e:Event)=>{const button=(e.target as Element).closest('button');setHelp(button?.title??'');};
 const clear=()=>setHelp('');
 root.addEventListener('pointerover',show);root.addEventListener('focusin',show);root.addEventListener('pointerleave',clear);root.addEventListener('focusout',clear);
 return()=>{root.removeEventListener('pointerover',show);root.removeEventListener('focusin',show);root.removeEventListener('pointerleave',clear);root.removeEventListener('focusout',clear);};
 },[]);
 return <span ref={anchor} className="tracking-hover-help" role="tooltip" hidden={!help}>{help}</span>;
}
const colors=['#ffc247','#c6f70e'];
const teamColor=(team:number)=>colors[team%colors.length];
function Tag({at,text,color='#fff'}:{at:XY;text:string;color?:string}){
 const width=text.length*6.5+14;
 return <g transform={`translate(${at[0]},${at[1]})`}><rect x={-width/2} y={-11} width={width} height={22} rx={5} fill="#101917" fillOpacity=".9"/><text textAnchor="middle" dominantBaseline="central" fill={color} fontSize="11" fontFamily="system-ui,sans-serif">{text}</text></g>;
}
function PairLink({a,b,color,inset=9}:{a:XY;b:XY;color:string;inset?:number}){
 const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<inset*2+4)return null;
 const ux=dx/length,uy=dy/length,from:XY=[a[0]+ux*inset,a[1]+uy*inset],to:XY=[b[0]-ux*inset,b[1]-uy*inset];
 const path=`M${from[0]},${from[1]} L${to[0]},${to[1]}`;
 const caps=[from,to].map(p=>`M${p[0]-uy*4},${p[1]+ux*4} L${p[0]+uy*4},${p[1]-ux*4}`).join(' ');
 return <g><path d={path} stroke="#071b26" strokeOpacity=".65" strokeWidth="4" fill="none"/><path d={path} stroke={color} strokeWidth="1.8" strokeDasharray="7 5" strokeLinecap="round" fill="none"/><path d={caps} stroke={color} strokeWidth="2" strokeLinecap="round"/></g>;
}
export default function TrackingOverlays({result,video,onCourtToolsHost,rallies=[]}:{rallies?:RallyWindow[];onCourtToolsHost?:(host:HTMLDivElement|null)=>void;result:AnalysisResult;video:RefObject<HTMLVideoElement|null>}){
 const {enabled:ruleColors,rules}=useTrackingRules();
 const [collapsed,setCollapsed]=useState(false);
 const [videoSpeed,setVideoSpeed]=useState(false),[videoPressure,setVideoPressure]=useState(false);
 const [mode,setMode]=useState<'off'|'positioning'|'movement'>('off');
 const [selection,setSelection]=useState('all'),[customize,setCustomize]=useState(false);
 const [connection,setConnection]=useState(true);
 const [net,setNet]=useState(true),[names,setNames]=useState(true),[trails,setTrails]=useState(true);
 const [time,setTime]=useState(0),[paused,setPaused]=useState(true);
 const [host,setHost]=useState<HTMLElement|null>(null),[box,setBox]=useState({width:0,height:0});
 const last=useRef(-1);
 useEffect(()=>{const v=video.current;if(!v)return;const el=v.parentElement!;setHost(el);
  const measure=()=>setBox({width:el.clientWidth,height:el.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(el);
  const state=()=>{setPaused(v.paused);setTime(v.currentTime);};state();v.addEventListener('play',state);v.addEventListener('pause',state);
  const stop=syncVideoFrames(v,t=>{if(v.paused||Math.abs(t-last.current)>=1/30){last.current=t;setTime(t);}});
  return()=>{stop();observer.disconnect();v.removeEventListener('play',state);v.removeEventListener('pause',state);};
 },[video]);
 const tracking=useTrackingWindow(result,time,mode!=='off'||videoSpeed||videoPressure);
 const players=result.manifest.players;
 const selected=players.filter(p=>selection==='all'||selection===p.key||selection===`team:${p.team}`);
 const current=selected.map(p=>({...p,xy:positionAt(tracking.rows,time,p.key)}));
 const teams=[...new Set(players.map(p=>p.team))];
 const pairs=teams.map(team=>current.filter(p=>p.team===team)).filter(ps=>ps.length===2&&ps.every(p=>p.xy));
 const assessments=Object.fromEntries(teams.map(team=>[team,assessPair(tracking.rows,time,players.filter(p=>p.team===team).map(p=>p.key),rules)]));
 const dims=tracking.manifest?.sourceDimensions;
 const calibrated=!!dims&&dims.length===2&&dims.every(n=>Number.isFinite(n)&&n>0)&&!!tracking.manifest&&!!projectCourt([5,10],tracking.manifest);
 const scale=calibrated?Math.min(box.width/dims![0],box.height/dims![1]):0;
 const offset:XY=calibrated?[(box.width-dims![0]*scale)/2,(box.height-dims![1]*scale)/2]:[0,0];
 function project(xy:XY):XY|null{const p=tracking.manifest&&projectCourt(xy,tracking.manifest);return p?[p[0]*scale+offset[0],p[1]*scale+offset[1]]:null;}
 function line(a:XY,b:XY,color:string,dashed=false){const from=project(a),to=project(b);return from&&to?<line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color} strokeWidth={1.5} strokeDasharray={dashed?'4 4':undefined}/>:null;}
 const hasPositions=current.some(p=>p.xy);
 const status=tracking.error|| (tracking.loading?'Loading saved tracking…':!hasPositions?'No reliable tracking at this moment.':!calibrated?'Video calibration unavailable. Court view remains available.':'');
 return <>
 {(mode!=='off'||videoSpeed||videoPressure)&&host&&createPortal(<div className="tracking-video-layer">{calibrated&&<svg aria-hidden="true" width="100%" height="100%" viewBox={`0 0 ${box.width||1} ${box.height||1}`}>
 {mode==='positioning'&&connection&&pairs.map(pair=>{const [a,b]=pair,mid=project([(a.xy![0]+b.xy![0])/2,(a.xy![1]+b.xy![1])/2]);return <g key={a.team}>{project(a.xy!)&&project(b.xy!)&&<PairLink a={project(a.xy!)!} b={project(b.xy!)!} color={ruleColors?PAIR_COLORS[assessments[a.team].level]:teamColor(a.team)}/>}{mid&&<Tag at={[mid[0],mid[1]-14]} text={`${pairMetrics(a.xy!,b.xy!).spacing.toFixed(1)} m`}/>}</g>;})}
 {current.map(p=>{if(!p.xy)return null;const at=project(p.xy);if(!at)return null;const ring=groundRing(p.xy,project),color=teamColor(p.team),netPoint:XY=[p.xy[0],10],netAt=project(netPoint),trail=mode==='movement'&&trails?trailAt(tracking.rows,time,p.key):[];
 return <g key={p.key}>{trail.slice(1).map((q,i)=><g key={q.time} opacity={.15+.7*(i+1)/trail.length}>{line(trail[i].xy,q.xy,color)}</g>)}
 {mode==='positioning'&&net&&netAt&&<>{line(p.xy,netPoint,color,true)}<Tag at={[(at[0]+netAt[0])/2+22,(at[1]+netAt[1])/2]} text={`Net ${Math.abs(p.xy[1]-10).toFixed(1)} m`}/></>}
 <g className="tracking-foot-marker" opacity={mode==='off'?0:1}>{ring&&<><path d={ring} fill={color} fillOpacity={.12} stroke="#101917" strokeOpacity={.7} strokeWidth={4.5}/><path d={ring} fill="none" stroke={color} strokeWidth={2}/></>}<circle cx={at[0]} cy={at[1]} r={2.5} fill={color} stroke="#101917" strokeWidth={1}/></g>{names&&mode!=='off'&&<Tag at={[Math.max((p.shortName??p.name).length*3.25+8,Math.min(box.width-(p.shortName??p.name).length*3.25-8,at[0])),Math.min(box.height-15,at[1]+25)]} text={p.shortName??p.name} color={color}/>} {videoSpeed&&<Tag at={[Math.max(48,Math.min(box.width-48,at[0])),Math.min(box.height-12,at[1]+(names&&mode!=='off'?47:25))]} text={`${speedAt(tracking.rows,time,p.key)?.toFixed(1)??'—'} km/h`} color="#ffffff"/>}</g>;})}
 </svg>}<span className="tracking-badge">{status||`${paused?'Paused review':'Tracking'} · observed positions`}</span>{mode==='positioning'&&connection&&ruleColors&&<div className="tracking-rule-reasons"><strong>Connection rules · experimental</strong>{teams.filter(team=>selected.filter(p=>p.team===team).length===2).map(team=><div key={team}><i style={{background:PAIR_COLORS[assessments[team].level]}}/><span>Team {teams.indexOf(team)+1} · {assessments[team].level}<br/>{assessments[team].reason}</span></div>)}<small>0.6s mean · geometry only, not a tactical verdict</small></div>}{videoPressure&&<div className="tracking-video-pressure" aria-label="Live team Pressure Index"><strong>Rally pressure <small>Last 5s · /100</small></strong><div>{teams.map((team,i)=>{const ps=players.filter(p=>p.team===team),metric=rallyPressure(tracking.rows,time,ps.map(p=>p.key),rallyAt(rallies,time));return <span key={team} title="Attack + transition occupancy, using paired observed tracking in the current rally"><i style={{background:teamColor(team)}}/><span>Team {i+1}<small>{ps.map(p=>p.shortName??p.name).join(' / ')}</small></span><b>{metric.score===null?'—':metric.score.toFixed(0)}</b></span>;})}</div><small>{rallyAt(rallies,time)?'Zone occupancy · gaps are unavailable':'Between rallies · unavailable'}</small></div>}</div>,host)}
 {host&&createPortal(<aside className="tracking-panel tracking-rail" data-collapsed={collapsed} aria-label="Video overlay settings" onClick={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')setCustomize(false);}}>
 <div className="tracking-panel-heading"><h3>Overlays</h3><button className="ui-btn tracking-details-toggle" aria-label="Overlay settings" title="Overlay settings and measurements" aria-expanded={customize} onClick={()=>setCustomize(!customize)}><OverlaySettings/></button><button className="ui-btn" aria-label={collapsed?'Expand overlay toolbar':'Collapse overlay toolbar'} title={collapsed?'Expand toolbar':'Collapse toolbar'} aria-expanded={!collapsed} onClick={()=>{setCollapsed(!collapsed);setCustomize(false);}}>{collapsed?<ArrowLeft size={14}/>:<ArrowRight size={14}/>}</button></div><div className="tracking-rail-body" hidden={collapsed}>
 <div className="tracking-controls" aria-label="Tracking overlays"><div role="group" aria-label="Overlay mode">{(['off','positioning','movement'] as const).map(value=><button key={value} className="ui-btn" data-variant={mode===value?'primary':'default'} aria-label={value==='positioning'?'Positioning':value==='movement'?'Movement':'Off'} title={value==='positioning'?'Team shape and net distances':value==='movement'?'Movement trails and speed':'Hide video overlays'} aria-pressed={mode===value} onClick={()=>{setMode(value);if(value==='off'){setVideoSpeed(false);setVideoPressure(false);}}}>{value==='positioning'?<TeamShape/>:value==='movement'?<MovementTrail/>:<OverlayOff/>}</button>)}</div></div>
 {mode==='positioning'&&<div className="tracking-measurement-controls" role="group" aria-label="Positioning measurements"><button className="ui-btn" title="Show or hide net distances" aria-label="Net distances" aria-pressed={net} data-variant={net?'primary':'default'} onClick={()=>setNet(!net)}><NetDistance/></button><button className="ui-btn" title="Show or hide teammate connection" aria-label="Teammate connection" aria-pressed={connection} data-variant={connection?'primary':'default'} onClick={()=>setConnection(!connection)}><PairConnection/></button></div>}
 <div className="tracking-video-metrics" role="group" aria-label="Video measurements"><button className="ui-btn" aria-label="Speed on video" title="Show one-second observed speed beside selected players in the video, without opening the court." aria-pressed={videoSpeed} data-variant={videoSpeed?'primary':'default'} onClick={()=>setVideoSpeed(!videoSpeed)}><MovementTrail/></button><button className="ui-btn" aria-label="Team pressure on video" title="Show both team Pressure Index scores over the video. Last 5 seconds within the current rally; court can stay closed." aria-pressed={videoPressure} data-variant={videoPressure?'primary':'default'} onClick={()=>setVideoPressure(!videoPressure)}><PressureGauge/></button></div>
 <div className="tracking-roster" aria-label="Overlay players">
 <button className="ui-btn" aria-label="Show all players" title="Show all players" data-variant={selection==='all'?'primary':'default'} aria-pressed={selection==='all'} onClick={()=>{setSelection('all');if(mode==='off')setMode('positioning');}}><PlayerGroup/></button>
 {teams.map((team,index)=><div className="tracking-team" role="group" aria-label={`Team ${index+1} controls`} key={team} style={{'--team-color':teamColor(team)} as CSSProperties}>
 <button className="ui-btn tracking-team-choice" data-variant={selection===`team:${team}`?'primary':'ghost'} title={`Show team ${index+1}`} aria-label={`Show team: ${players.filter(p=>p.team===team).map(p=>p.shortName??p.name).join(' and ')}`} aria-pressed={selection===`team:${team}`} onClick={()=>{setSelection(`team:${team}`);if(mode==='off')setMode('positioning');}}><i/><span>Team {index+1}</span><PlayerGroup size={13}/></button>
 <div className="tracking-team-players">{players.filter(p=>p.team===team).map(p=><button key={p.key} className="ui-btn tracking-avatar-choice" data-variant={selection===p.key?'primary':'ghost'} aria-label={`Show ${p.name}`} aria-pressed={selection===p.key} title={p.name} onClick={()=>{setSelection(p.key);if(mode==='off')setMode('positioning');}}><span className="tracking-avatar" data-active={selected.some(q=>q.key===p.key)&&mode!=='off'}>{p.avatar?<img src={p.avatar} alt="" onError={e=>{e.currentTarget.style.display='none';}}/>:null}<span>{p.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span></span><span className="tracking-avatar-name">{p.shortName??p.name}{mode==='movement'&&selected.some(q=>q.key===p.key)&&<small>{speedAt(tracking.rows,time,p.key)?.toFixed(1)??'—'} km/h</small>}</span></button>)}</div>
 </div>)}
 </div>
 <div className="tracking-court-controls" ref={onCourtToolsHost}/>

 </div>
 {customize&&<div className="tracking-detail-popover"><div className="tracking-detail-title"><strong>Overlay details</strong><button className="ui-btn" aria-label="Close overlay details" onClick={()=>setCustomize(false)}>×</button></div>
 <TrackingRuleControls/>
 {mode!=='off'&&<div className="tracking-options"><label><input type="checkbox" checked={names} onChange={e=>setNames(e.target.checked)}/>Player names</label>{mode==='positioning'?<label><input type="checkbox" checked={net} onChange={e=>setNet(e.target.checked)}/>Net distances</label>:<label><input type="checkbox" checked={trails} onChange={e=>setTrails(e.target.checked)}/>Trails · last 2 seconds</label>}<small>Net distances can be shown or hidden during playback and when paused.</small></div>}
 {mode==='off'&&<p className="tracking-off-hint">Choose a view to inspect player positioning or movement.</p>}
 {mode!=='off'&&<div className="tracking-readout">{status&&<span role="status">{status} {tracking.error&&<button className="ui-btn" onClick={tracking.retry}>Retry</button>}</span>}
 {mode==='movement'&&current.map(p=>{const speed=speedAt(tracking.rows,time,p.key);return <span key={p.key}><i style={{background:teamColor(p.team)}}/>{p.shortName??p.name} <strong>{speed==null?'—':`${speed.toFixed(1)} km/h`}</strong></span>;})}
 {mode==='positioning'&&paused&&pairs.map(([a,b])=>{const m=pairMetrics(a.xy!,b.xy!);return <span key={a.team}>{a.shortName??a.name} / {b.shortName??b.name} · <strong>{m.spacing.toFixed(1)} m apart</strong> · depth difference <strong>{m.depth.toFixed(1)} m</strong></span>;})}
 <small>{mode==='movement'?'Speed: 1-second displacement. Gaps are unavailable, not zero. ':'Distances measured on the court floor. '}Player identities after cuts may need review.</small></div>}
 </div>}
 <ToolbarHelp/></aside>,host)}</>;
}

export function TrackingCourt2D({result,time,showZones=false,showPressure=false,showSpeed=false,rallies=[]}:{result:AnalysisResult;time:number;showZones?:boolean;showPressure?:boolean;showSpeed?:boolean;rallies?:RallyWindow[]}){
 const {rows,loading,error,retry}=useTrackingWindow(result,time);
 const {enabled:ruleColors,rules}=useTrackingRules();
 const id=useId().replaceAll(':','');
 const players=result.manifest.players.map(p=>({...p,xy:positionAt(rows,time,p.key)}));
 // Match the broadcast orientation: court x runs left-to-right, far baseline is at the top.
 const point=(xy:XY):XY=>[60+xy[0]*12,28+xy[1]*12];
 const teams=[...new Set(players.map(p=>p.team))];
 const zonesAvailable=supportsCourtZones(result.manifest.zoneSchema);
 const rally=rallyAt(rallies,time);
 return <div className="tracking-court-2d tracking-court-portraits"><svg viewBox={showPressure||showSpeed?"0 0 420 340":"0 0 240 340"} role="img" aria-label="2D court with player portraits at observed positions; far end at the top, near end at the bottom">
 <defs><linearGradient id={`${id}-surface`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#226f9b"/><stop offset="1" stopColor="#124766"/></linearGradient>{players.map((p,i)=><clipPath id={`${id}-avatar-${i}`} key={p.key}><circle r="12"/></clipPath>)}</defs>
 <text x="120" y="16" textAnchor="middle" className="court-end-label">FAR END</text><text x="120" y="283" textAnchor="middle" className="court-end-label">NEAR END</text>
 <rect x="53" y="21" width="134" height="254" rx="5" fill="#0d2532" stroke="#4d7285"/>
 <rect x="60" y="28" width="120" height="240" fill={`url(#${id}-surface)`} stroke="#c4dce5" strokeWidth="1.2"/>
 {showZones&&zonesAvailable&&COURT_ZONES.flatMap(zone=>[-1,1].map(side=>{const y=28+(10+(side===-1?-zone.far:zone.near))*12;const height=(zone.far-zone.near)*12;return <g key={`${zone.key}-${side}`} aria-label={`${zone.label}: ${zone.near}–${zone.far} metres from net`}><rect x="60" y={y} width="120" height={height} fill={zone.color} fillOpacity=".25"/><path d={`M60 ${y}h120M60 ${y+height}h120`} stroke={zone.color} strokeDasharray="2 3" strokeWidth=".7"/><text x="56" y={y+height/2-2} textAnchor="end" fill={zone.color} fontSize="7">{zone.label}</text><text x="56" y={y+height/2+8} textAnchor="end" fill="#b8cbd4" fontSize="6.5">{zone.near}–{zone.far} m</text></g>;}))}
 <path d="M60 64h120M60 232h120M120 64v168" stroke="#c4dce5" strokeWidth=".9" fill="none"/>
 <path d="M57 148h126" stroke="#071b26" strokeWidth="5"/><path d="M57 148h126" stroke="#edf7fa" strokeWidth="2" strokeDasharray="2 2"/>
 {teams.map(team=>{const ps=players.filter(p=>p.team===team);if(ps.length!==2||!ps[0].xy||!ps[1].xy)return null;const a=point(ps[0].xy),b=point(ps[1].xy);return <PairLink key={team} a={a} b={b} color={ruleColors?PAIR_COLORS[assessPair(rows,time,ps.map(p=>p.key),rules).level]:teamColor(team)} inset={16}/>;})}
 {players.map((p,i)=>{if(!p.xy)return null;const [x,y]=point(p.xy),label=p.shortName??p.name;return <g key={p.key} role="img" aria-label={`${p.name}, ${Math.abs(p.xy[1]-10).toFixed(1)} metres from net`}><title>{p.name} · {Math.abs(p.xy[1]-10).toFixed(1)} m from net</title><g transform={`translate(${x},${y})`}><circle r="15" fill="#071b26" fillOpacity=".75"/><circle r="13.5" fill="#e9eee8" stroke={teamColor(p.team)} strokeWidth="2.5"/><text textAnchor="middle" dominantBaseline="central" fill="#263123" fontSize="8" fontWeight="700">{p.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</text>{p.avatar&&<image href={p.avatar} x="-12" y="-12" width="24" height="24" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-avatar-${i})`} onError={e=>{e.currentTarget.style.display='none';}}/>}</g><g transform={`translate(${Math.max(40,Math.min(200,x))},${y>248?y-21:y+23})`}><rect x={-label.length*2.1-5} y="-6" width={label.length*4.2+10} height="13" rx="4" fill="#071b26" fillOpacity=".9"/><text textAnchor="middle" dominantBaseline="central" fill="#f4f8fa" fontSize="7.5">{label}</text>{showSpeed&&<text y="17" textAnchor="middle" fill="#fff" stroke="#071b26" strokeWidth="2" paintOrder="stroke" fontSize="8" fontWeight="600">{speedAt(rows,time,p.key)?.toFixed(1)??'—'} km/h</text>}</g></g>;})}
 {teams.map((team,i)=>{const ps=players.filter(p=>p.team===team),spacing=ps.length===2&&ps.every(p=>p.xy)?pairMetrics(ps[0].xy!,ps[1].xy!).spacing:null;return <g key={team} transform={`translate(${8+i*116},294)`}><rect width="108" height="39" rx="6" fill="#19313e"/><circle cx="11" cy="12" r="3" fill={teamColor(team)}/><text x="20" y="15" fill="#c6d8df" fontSize="8">Team {i+1} spacing</text><text x="10" y="30" fill="#f4f8fa" fontSize="12" fontWeight="600">{spacing===null?'—':`${spacing.toFixed(1)} m`}</text></g>;})}
 {(showPressure||showSpeed)&&<g className="court-pressure-panel" transform="translate(244,22)"><text fill="#f4f8fa" fontSize="12" fontWeight="700">{showPressure?'Rally Pressure Index':'Player speed'}</text><text y="15" fill="#b8cbd4" fontSize="8">{showPressure?(rally?'Last 5s · current rally':'Between rallies · unavailable'):'Observed · 1-second displacement'}</text>{teams.map((team,i)=>{const ps=players.filter(p=>p.team===team),metric=rallyPressure(rows,time,ps.map(p=>p.key),rally);return <g key={team} transform={`translate(0,${28+i*109})`}><rect width="166" height="102" rx="6" fill="#19313e"/><circle cx="10" cy="15" r="3" fill={teamColor(team)}/><text x="19" y="18" fill="#e7eff2" fontSize="10">Team {i+1}</text>{showPressure&&<><text x="156" y="18" textAnchor="end" fill="#f4f8fa" fontSize="14" fontWeight="600">{metric.score===null?'—':metric.score.toFixed(0)}<tspan fontSize="8"> / 100</tspan></text><text x="10" y="32" fill="#b8cbd4" fontSize="7.5">{rally?`${(100*metric.coverage).toFixed(0)}% paired tracking · ${metric.seconds.toFixed(1)}s`:'No active rally'}</text></>}{ps.map((p,j)=>{const value=rallyPressure(rows,time,[p.key],rally),speed=speedAt(rows,time,p.key);return <g key={p.key} transform={`translate(10,${48+j*26})`}><text fill="#e7eff2" fontSize="9">{p.shortName??p.name}</text><text y="11" fill="#b8cbd4" fontSize="8">{[showPressure?`PI ${value.score===null?'—':value.score.toFixed(0)}`:'',showSpeed?`${speed===null?'—':speed.toFixed(1)} km/h`:''].filter(Boolean).join(' · ')}</text></g>;})}</g>;})}<text y="260" fill="#b8cbd4" fontSize="8">{showPressure?<><tspan x="0">PI = % time in attack + transition.</tspan><tspan x="0" dy="12">Team = equal share of both players.</tspan><tspan x="0" dy="12">≥0.5s tracked; ≥60% window coverage.</tspan><tspan x="0" dy="12">Position occupancy, not shot pressure.</tspan></>:<><tspan x="0">Speed uses observed positions only.</tspan><tspan x="0" dy="12">No estimates across cuts or gaps.</tspan></>}</text></g>}

 </svg>
 {(loading||error||!players.some(p=>p.xy))&&<p role="status">{error|| (loading?'Loading tracking…':'No reliable tracking at this moment.')}{error&&<button className="ui-btn" onClick={retry}>Retry</button>}</p>}
 <small>{showZones&&!zonesAvailable?'Zones unavailable: unsupported analysis schema':ruleColors?'Connection colors: trial geometry rules · see overlay settings':'Observed positions · identities may need review'}</small></div>;
}
