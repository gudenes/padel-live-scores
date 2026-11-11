import type {TrackRow} from './movement-series';
export type MotionSample={time:number;start:number;end:number;x:number;y:number;speed:number;acceleration:number|null;run:number};
export type Sprint={start:number;end:number;from:[number,number];to:[number,number];peak:number;distance:number;direction:string};
/** Local estimates from saved observations; regression reduces frame-to-frame position jitter. */
export function motionSeries(rows:TrackRow[],keys:string[]):Record<string,MotionSample[]>{
 const out:Record<string,MotionSample[]>={};
 for(const key of keys){const samples:MotionSample[]=[];let run:TrackRow[]=[];let runId=0;
 const flush=()=>{runId++;const velocities:MotionSample[]=[];
 for(let i=0;i<run.length;i++){const centre=run[i].source_s;const window=run.slice(Math.max(0,i-16),i+17).filter(r=>Math.abs(r.source_s-centre)<=.251);if(window.length<5||window.at(-1)!.source_s-window[0].source_s<.399)continue;
 const meanT=window.reduce((s,r)=>s+r.source_s,0)/window.length;const x=window.reduce((s,r)=>s+r.players[key].court_m![0],0)/window.length,y=window.reduce((s,r)=>s+r.players[key].court_m![1],0)/window.length;
 const denominator=window.reduce((s,r)=>s+(r.source_s-meanT)**2,0);
 const vx=window.reduce((s,r)=>s+(r.source_s-meanT)*(r.players[key].court_m![0]-x),0)/denominator,vy=window.reduce((s,r)=>s+(r.source_s-meanT)*(r.players[key].court_m![1]-y),0)/denominator;
 const speed=Math.hypot(vx,vy)*3.6;if(speed>30)continue;
 let previous:MotionSample|undefined;for(let j=velocities.length-1;j>=0;j--){if(centre-velocities[j].time>=.499){previous=velocities[j];break;}}const dt=previous?centre-previous.time:0;const acceleration=previous&&dt<=.61?(speed-previous.speed)/3.6/dt:null;
 velocities.push({time:centre,start:previous?Math.min(previous.start,window[0].source_s):window[0].source_s,end:window.at(-1)!.source_s,x,y,speed,acceleration:acceleration!==null&&Math.abs(acceleration)<=12?acceleration:null,run:runId});
 // Only the previous velocity's support, not the whole run, is needed for selection boundaries.
 velocities[velocities.length-1].start=previous?Math.max(run[0].source_s,previous.time-.25):window[0].source_s;
 }samples.push(...velocities);run=[];};
 for(const row of rows){const p=row.players[key],xy=p?.court_m;const prev=run.at(-1),dt=prev?row.source_s-prev.source_s:0;
 const valid=row.overlay_visible&&row.segment_id!=null&&p?.position_source==='observed'&&xy?.length===2&&xy.every(Number.isFinite);
 if(!valid){flush();continue;}
 if(prev&&(row.segment_id!==prev.segment_id||dt<=0||dt>.15||Math.hypot(xy![0]-prev.players[key].court_m![0],xy![1]-prev.players[key].court_m![1])/dt>10))flush();
 run.push(row);
 }flush();out[key]=samples;
 }return out;
}
export function effortSummary(all:MotionSample[],windows?:{start:number;end:number}[]){
 const samples=windows?all.filter(s=>windows.some(w=>s.start>=w.start&&s.end<=w.end)):all;
 const sprints:Sprint[]=[];let active:MotionSample[]=[];
 const flush=()=>{if(active.length>1&&active.at(-1)!.time-active[0].time>=.499){const first=active[0],last=active.at(-1)!,dx=last.x-first.x,dy=last.y-first.y;const forward=dy*(first.y<10?1:-1),angle=Math.atan2(Math.abs(dx),Math.abs(forward))*180/Math.PI;
 const direction=angle>67.5?'Lateral':angle<22.5?(forward>=0?'Toward net':'Toward back glass'):(forward>=0?'Diagonal toward net':'Diagonal toward back glass');
 sprints.push({start:first.time,end:last.time,from:[first.x,first.y],to:[last.x,last.y],peak:Math.max(...active.map(s=>s.speed)),distance:active.slice(1).reduce((sum,s,i)=>sum+Math.hypot(s.x-active[i].x,s.y-active[i].y),0),direction});}active=[];};
 for(const s of samples){const prev=active.at(-1);if(prev&&(prev.run!==s.run||s.time-prev.time>.15))flush();if(s.speed>=12)active.push(s);else flush();}flush();
 const accelerations=samples.flatMap(s=>s.acceleration===null?[]:[s.acceleration]);
 return {samples,sprints,acceleration:accelerations.length?accelerations.reduce((max,a)=>Math.max(max,a),0):null,braking:accelerations.length?accelerations.reduce((max,a)=>Math.max(max,-a),0):null};
}
