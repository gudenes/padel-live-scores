import {scoutToVideo,type ScoutingAlignment} from './scouting-alignment';
import type {SpeedSample} from './movement-series';
export type MovementPoint={id:string;number:number;breakPoint?:'a'|'b'|null;breakConverted?:boolean;start:number|null;end:number|null;before:{sets:{a:number;b:number}[];currentGame:{a:number|string;b:number|string}}};
export type MovementGroup={id:string;label:string;windows:{start:number;end:number}[];points:number};
export function movementGroups(points:MovementPoint[],level:'set'|'game'|'point',start:number,end:number,offset:number,alignment?:ScoutingAlignment){
 const groups=new Map<string,MovementGroup>();let excluded=0;
 for(const p of points){if(p.start==null||p.end==null){excluded++;continue;}
 const a=scoutToVideo(p.start,offset,alignment),b=scoutToVideo(p.end,offset,alignment);
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||a<start||b>end||(alignment?.segments??[]).some(s=>s.sourceFrom>p.start!&&s.sourceFrom<p.end!)){excluded++;continue;}
 const set=p.before.sets.length,score=p.before.sets.at(-1),game=(score?.a??0)+(score?.b??0)+1;
 const id=level==='set'?`s${set}`:level==='game'?`s${set}g${game}`:p.id;
 const label=level==='set'?`Set ${set}`:level==='game'?`Set ${set} · Game ${game}`:`Point ${p.number} · S${set} G${game} · ${p.before.currentGame.a}–${p.before.currentGame.b}`;
 if(!groups.has(id))groups.set(id,{id,label,windows:[],points:0});const g=groups.get(id)!;g.windows.push({start:a,end:b});g.points++;
 }
 for(const g of groups.values()){g.windows.sort((a,b)=>a.start-b.start);const merged:typeof g.windows=[];for(const w of g.windows){const last=merged.at(-1);if(last&&w.start<=last.end)last.end=Math.max(last.end,w.end);else merged.push({...w});}g.windows=merged;}
 return {groups:[...groups.values()],excluded};
}
export function summarizeMovement(samples:SpeedSample[],windows?:{start:number;end:number}[]){
 const selected=windows?samples.filter(s=>windows.some(w=>s.time-s.duration>=w.start-0.0001&&s.time<=w.end+0.0001)):samples;
 const seconds=selected.reduce((a,s)=>a+s.duration,0),distance=selected.reduce((a,s)=>a+s.distance,0),zones=[0,0,0];
 for(const s of selected)s.zoneSeconds?.forEach((n,i)=>{zones[i]+=n});
 return {samples:selected,seconds,distance,zones,average:seconds?distance/seconds*3.6:null,peak:selected.length?Math.max(...selected.map(s=>s.speed)):null};
}


export function breakMovement(points:MovementPoint[],samples:SpeedSample[],start:number,end:number,offset:number,alignment:ScoutingAlignment|undefined,playerTeam:'a'|'b'){
 const aligned=movementGroups(points,'point',start,end,offset,alignment).groups;
 const byId=new Map(points.map(p=>[p.id,p]));
 const events=aligned.filter(g=>byId.get(g.id)?.breakPoint).map(g=>({time:g.windows[0].start,end:g.windows.at(-1)!.end,number:byId.get(g.id)!.number,converted:!!byId.get(g.id)!.breakConverted,team:byId.get(g.id)!.breakPoint!}));
 const comparisons=(['saving','winning','other'] as const).map(role=>{
  const groups=aligned.filter(g=>{const bp=byId.get(g.id)?.breakPoint;return role==='other'?!bp:!!bp&&(role==='winning'?bp===playerTeam:bp!==playerTeam)});
  const measured=groups.map(g=>summarizeMovement(samples,g.windows)).filter(s=>s.seconds>0);
  const total=summarizeMovement(samples,groups.flatMap(g=>g.windows));
  const successes=groups.filter(g=>role==='winning'?byId.get(g.id)?.breakConverted:role==='saving'&&!byId.get(g.id)?.breakConverted).length;
  return {role,label:role==='saving'?'Saving a break':role==='winning'?'Trying to win a break':'Other rallies',successes,points:groups.length,trackedPoints:measured.length,...total,intensity:total.seconds?total.distance/total.seconds*60:null};
 });
 return {events,comparisons};
}
