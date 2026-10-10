import {activeEvents,replay,type ScoutDoc} from './model'
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

// Subtract cumulative replay snapshots, preserving the real score/serve context.
// Separate runs also handle manual corrections that revisit an earlier set.
function countDelta(end:unknown,start:unknown,total:unknown):unknown {
 if(typeof end==='number')return (typeof total==='number'?total:0)+end-(typeof start==='number'?start:0)
 const a=(start??{}) as Record<string,unknown>,b=(total??{}) as Record<string,unknown>
 return Object.fromEntries(Object.entries(end as Record<string,unknown>).map(([key,value])=>[key,countDelta(value,a[key],b[key])]))
}
export function scopedStats(doc:ScoutDoc,all:TimelinePoint[],selected:TimelinePoint[]){
 const events=activeEvents(doc),positions=new Map(events.map((event,i)=>[event.id,i])),included=new Set(selected.map(p=>p.id))
 const empty=replay({...doc,events:[]})
 let stats=empty.stats,service=empty.tracking.service
 for(let i=0;i<all.length;i++){
  if(!included.has(all[i].id))continue
  const first=i
  while(i+1<all.length&&included.has(all[i+1].id))i++
  const before=first?replay({...doc,events:events.slice(0,positions.get(all[first-1].id)!+1)}):empty
  const after=replay({...doc,events:events.slice(0,positions.get(all[i].id)!+1)})
  stats=stats.map((total,j)=>countDelta(after.stats[j],before.stats[j],total)) as typeof stats
  service=service.map((total,j)=>countDelta(after.tracking.service[j],before.tracking.service[j],total)) as typeof service
 }
 return {stats,service}
}
export function teamSummary(points:TimelinePoint[],snapshot:ReturnType<typeof scopedStats>){
 return (['a','b'] as const).map((team,index)=>{
  const players=snapshot.stats.slice(index*2,index*2+2),service=snapshot.service.slice(index*2,index*2+2)
  const sum=(key:keyof Omit<typeof players[number],'shots'>)=>players.reduce((n,p)=>n+p[key],0)
  return {team,winners:sum('winners'),unforced:sum('unforced'),forced:sum('forced'),created:sum('forcedErrorsCreated'),assists:sum('assists'),smashWinners:sum('smashWinners'),smashPointsWon:sum('smashPointsWon'),smashErrorsGenerated:sum('smashErrorsGenerated'),smashes:sum('smashes'),doubleFaults:service.reduce((n,s)=>n+s.doubleFaults,0),breaks:points.filter(p=>p.breakConverted&&p.winner===team).length,breakPoints:points.filter(p=>p.breakPoint===team).length,won:points.filter(p=>p.winner===team).length}
 })
}
