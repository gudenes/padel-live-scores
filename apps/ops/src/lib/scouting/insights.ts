import type {TimelinePoint} from './tracking'
// A descriptive count, not a weighted performance rating or win probability.
export function playerEvolution(points:TimelinePoint[]){
 const totals=[0,0,0,0]
 return points.map(p=>{
  if(p.player!==null){if(p.outcome==='winner')totals[p.player]++;else if(['forced','unforced','double_fault'].includes(p.outcome))totals[p.player]--}
  return {number:p.number,values:[...totals]}
 })
}

// Use the pre-point score: a set-winning point belongs to the set it closes.
// Keep separate segments if a manual correction moves back to an earlier set.
export function setSegments(points:TimelinePoint[]){
 const segments:{set:number;first:number;last:number;score:{a:number;b:number};complete:boolean}[]=[]
 for(const p of points){
  const set=p.before.sets.length
  let segment=segments.at(-1)
  if(!segment||segment.set!==set){segment={set,first:p.number,last:p.number,score:p.before.sets[set-1],complete:false};segments.push(segment)}
  segment.last=p.number;segment.score=p.after.sets[set-1]
  segment.complete=p.after.sets.length>set||p.after.phase==='finished'
 }
 return segments
}
