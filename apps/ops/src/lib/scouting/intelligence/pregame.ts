import type {HistoryMatch} from './data'
import {aggregate, type Match, type Person} from './model'
import {averageOfficialDuration, officialSeason, partnership, playerWon, historyGroups} from './history'
import {benchmarks} from './benchmarks'

/** One zero-based domain for every bar and every tick (minutes). */
export function durationScale(values:(number|null)[]) {
 const max=Math.max(120,...values.filter((v):v is number=>v!==null&&Number.isFinite(v)&&v>0))
 const ceiling=Math.ceil(max/30)*30
 return {max:ceiling,ticks:Array.from({length:ceiling/30+1},(_,i)=>i*30)}
}
export function durationPercent(minutes:number|null,max:number) {
 return minutes===null||!Number.isFinite(minutes)||max<=0?0:Math.max(0,Math.min(100,minutes/max*100))
}
export function opposing(m:HistoryMatch,a:string,b:string){const i=m.playerIds.indexOf(a),j=m.playerIds.indexOf(b);return i>=0&&j>=0&&Math.floor(i/2)!==Math.floor(j/2)}
export function buildPregame(source:{people:Person[];history:HistoryMatch[];matches:Match[]},target:HistoryMatch,year?:string,now=Date.now()) {
 const ids=target.playerIds
 if(ids.length!==4||ids.some(id=>!id)||new Set(ids).size!==4)throw Error('Four identified players are required.')
 const targetTime=target.date?Date.parse(target.date):NaN
 // Missing schedules cannot provide a trustworthy historical cutoff.
 if(!Number.isFinite(targetTime))throw Error('A scheduled match date is required for pre-game history.')
 const cutoff=Math.min(targetTime,now)
 const before=(m:{id:string;manual:boolean;date:string|null})=>m.id!==target.id&&!m.manual&&!!m.date&&Number.isFinite(Date.parse(m.date))&&Date.parse(m.date)<cutoff
 const history=source.history.filter(before)
 const matches=source.matches.filter(before)
 const selectedYear=year??String(new Date(targetTime).getUTCFullYear())
 const people=ids.map(id=>source.people.find(p=>p.id===id))
 if(people.some(p=>!p))throw Error('Player profiles are not available.')
 const players=people.map(person=>{
  const p=person!,own=history.filter(m=>m.playerIds.includes(p.id)),seasonHistory=own.filter(m=>m.date?.startsWith(selectedYear))
  const season=officialSeason(seasonHistory,p.id)
  return {person:p,season:{wins:season.wins,losses:season.losses,total:season.total,titles:season.titles.length,tournaments:historyGroups(seasonHistory).length},duration:averageOfficialDuration(own),summary:aggregate(matches,[p.id]),benchmarks:benchmarks(matches,[p])}
 })
 const finished=history.filter(m=>m.status==='finished'&&(m.winner===1||m.winner===2))
 const samePair=(m:HistoryMatch,a:string,b:string)=>{const i=m.playerIds.indexOf(a);return i>=0&&m.playerIds[i^1]===b}
 const meetings=finished.filter(m=>samePair(m,ids[0]!,ids[1]!)&&samePair(m,ids[2]!,ids[3]!))
 const encounters=ids.slice(0,2).flatMap(a=>ids.slice(2).map(b=>{const rows=finished.filter(m=>opposing(m,a!,b!));return {a:a!,b:b!,wins:rows.filter(m=>playerWon(m,a!)).length,losses:rows.filter(m=>!playerWon(m,a!)).length,matches:rows}}))
 return {year:selectedYear,years:[...new Set([String(new Date(targetTime).getUTCFullYear()),...history.filter(m=>m.playerIds.some(id=>ids.includes(id))).map(m=>m.date!.slice(0,4))])].sort().reverse(),cutoff:new Date(cutoff).toISOString(),players,pairs:[partnership(history,ids[0]!,ids[1]!),partnership(history,ids[2]!,ids[3]!)],meetings,encounters}
}
export type PregameData=ReturnType<typeof buildPregame>
