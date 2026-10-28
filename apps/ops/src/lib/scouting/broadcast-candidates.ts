export type BroadcastMatch = { id:string; tournament:string; court:string|null; startedAt:string|null; scheduledAt:string|null; timezone:string }
export type BroadcastCandidate = { videoId:string; title:string; court:string|null; start:string|null; end:string|null; state:string; courtMatched:boolean; suggestedOffset:number|null }
/** Only known court aliases; never guess that two different numbered courts match. */
export function courtKey(value:string|null):string|null {
 if(!value)return null
 const s=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(/\b(centre|center|central)\b/.test(s))return 'centre'
 const number=s.match(/\b(?:court|pista|cancha)\s*(\d+)\b/)
 return number?'court-'+Number(number[1]):null
}
export function localDay(value:string,timezone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))}
export function rankBroadcasts(match:BroadcastMatch,rows:Omit<BroadcastCandidate,'courtMatched'|'suggestedOffset'>[]):BroadcastCandidate[]{
 const time=match.startedAt??match.scheduledAt
 if(!time)return []
 const day=localDay(time,match.timezone),point=Date.parse(time)
 return rows.filter(row=>{
  if(!row.start)return false
  const start=Date.parse(row.start),end=row.end?Date.parse(row.end):null
  return localDay(row.start,match.timezone)===day||(start<=point&&end!==null&&end>=point)
 }).map(row=>{
  const expected=courtKey(match.court),courtMatched=!!expected&&expected===courtKey(row.court??row.title)
  const offset=match.startedAt&&row.start?(Date.parse(match.startedAt)-Date.parse(row.start))/1000:null
  const within=offset!==null&&Number.isFinite(offset)&&offset>=0&&(!row.end||Date.parse(match.startedAt!)<=Date.parse(row.end))
  return {...row,courtMatched,suggestedOffset:courtMatched&&within?Math.floor(offset!):null}
 }).sort((a,b)=>Number(b.courtMatched)-Number(a.courtMatched)||Number(b.suggestedOffset!==null)-Number(a.suggestedOffset!==null)||a.title.localeCompare(b.title))
}
export function parseReplayTime(value:string):number|null{
 if(!/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(value))return null
 const [h,m,s]=value.split(':').map(Number);return h*3600+m*60+s
}
export function replayTime(seconds:number){const n=Math.max(0,Math.floor(seconds));return [Math.floor(n/3600),Math.floor(n/60)%60,n%60].map(x=>String(x).padStart(2,'0')).join(':')}
