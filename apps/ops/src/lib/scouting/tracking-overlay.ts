import type {TrackRow} from './movement-series';
export type XY = [number, number];
export type OverlayManifest = {start:number;end:number;sourceDimensions?:number[];inverseHomography?:number[][]};
export function validXY(p: number[]|undefined): p is XY {
 return !!p && p.length===2 && p.every(Number.isFinite);
}
/** Only observed, timely samples. Never carry positions into cuts or gaps. */
export function observed(row:TrackRow|undefined,key:string):XY|null {
 const p=row?.players[key];
 return row?.overlay_visible && row.segment_id!=null && p?.position_source==='observed' && validXY(p.court_m)?p.court_m:null;
}
export function rowIndex(rows:TrackRow[],time:number){
 let lo=0,hi=rows.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].source_s<=time)lo=mid+1;else hi=mid;}return lo-1;
}
export function positionAt(rows:TrackRow[],time:number,key:string):XY|null {
 const i=rowIndex(rows,time),a=rows[i],p=observed(a,key);
 if(!a||!p||time-a.source_s>.15)return null;
 const b=rows[i+1],q=observed(b,key);
 if(b&&q&&b.segment_id===a.segment_id&&b.source_s-a.source_s<=.15){const f=(time-a.source_s)/(b.source_s-a.source_s);return [p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f];}
 return p;
}
export function trailAt(rows:TrackRow[],time:number,key:string,seconds=2):{time:number;xy:XY}[]{
 const current=positionAt(rows,time,key);if(!current)return [];
 const i=rowIndex(rows,time),segment=rows[i].segment_id,out:{time:number;xy:XY}[]=[];
 let next=time;
 for(let j=i;j>=0&&rows[j].source_s>=time-seconds;j--){const row=rows[j],xy=observed(row,key);
  if(!xy||row.segment_id!==segment||next-row.source_s>.15)break;
  out.push({time:row.source_s,xy});next=row.source_s;
 }
 out.reverse();if(out.at(-1)?.time!==time)out.push({time,xy:current});return out;
}
export function speedAt(rows:TrackRow[],time:number,key:string):number|null {
 const trail=trailAt(rows,time,key,1.2),end=trail.at(-1);
 if(!end)return null;
 const start=trail.find(p=>end.time-p.time<=1.1&&end.time-p.time>=.999);
 if(!start)return null;
 const speed=Math.hypot(end.xy[0]-start.xy[0],end.xy[1]-start.xy[1])/(end.time-start.time)*3.6;
 return speed<=30?speed:null;
}
export function pairMetrics(a:XY,b:XY){return {spacing:Math.hypot(a[0]-b[0],a[1]-b[1]),depth:Math.abs(Math.abs(a[1]-10)-Math.abs(b[1]-10))};}
export function projectCourt(xy:XY,manifest:OverlayManifest):XY|null {
 const h=manifest.inverseHomography;
 if(!h||h.length!==3||h.some(r=>r.length!==3||!r.every(Number.isFinite)))return null;
 const q=h.map(r=>r[0]*xy[0]+r[1]*xy[1]+r[2]);
 if(Math.abs(q[2])<1e-8)return null;
 const p:XY=[q[0]/q[2],q[1]/q[2]];return p.every(Number.isFinite)?p:null;
}

/** A ground-plane circle, projected through the same calibration as the player. */
export function groundRing(center:XY,project:(xy:XY)=>XY|null,radius=.38):string|null {
 const points=Array.from({length:40},(_,i)=>{const angle=i/40*Math.PI*2;return project([center[0]+Math.cos(angle)*radius,center[1]+Math.sin(angle)*radius]);});
 if(points.some(p=>!p))return null;
 return points.map((p,i)=>`${i?'L':'M'}${p![0].toFixed(2)},${p![1].toFixed(2)}`).join(' ')+' Z';
}
