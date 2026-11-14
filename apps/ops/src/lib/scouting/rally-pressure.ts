import type {TrackRow} from './movement-series';
import {observed,rowIndex,positionAt} from './tracking-overlay';
export type RallyWindow={start:number|null;end:number|null};
export function rallyAt(rallies:RallyWindow[],time:number){
 return rallies.filter(r=>r.start!==null&&r.end!==null&&r.start<=time&&time<r.end).sort((a,b)=>b.start!-a.start!)[0]??null;
}
/** Rolling zone occupancy. Only paired observations count; never bridge cuts, gaps or rally boundaries. */
export function rallyPressure(rows:TrackRow[],time:number,keys:string[],rally:RallyWindow|null){
 if(!rally||rally.start===null||rally.end===null||time<rally.start||time>=rally.end||!keys.length)return {score:null,coverage:0,seconds:0};
 if(keys.some(k=>!positionAt(rows,time,k)))return {score:null,coverage:0,seconds:0};
 const start=Math.max(rally.start,time-5),duration=time-start;
 let known=0,forward=0;
 for(let i=Math.max(0,rowIndex(rows,start));i<rows.length-1&&rows[i].source_s<time;i++){
  const a=rows[i],b=rows[i+1],dt=b.source_s-a.source_s;
  if(dt<=0||dt>.15||a.segment_id!==b.segment_id)continue;
  const positions=keys.map(k=>[observed(a,k),observed(b,k)]);
  if(positions.some(ps=>ps.some(p=>!p||p[0]<0||p[0]>10||p[1]<0||p[1]>20)))continue;
  const seconds=Math.max(0,Math.min(time,b.source_s)-Math.max(start,a.source_s));
  known+=seconds;forward+=seconds*positions.filter(([p])=>Math.abs(p![1]-10)<7).length/keys.length;
 }
 const coverage=duration>0?known/duration:0;
 return {score:known>=.5&&coverage>=.6?100*forward/known:null,coverage,seconds:known};
}
