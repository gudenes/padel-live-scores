import type {HistoryMatch} from './data'
export function playerWon(m:HistoryMatch,id:string){return m.playerIds.includes(id)&&m.winner===Math.floor(m.playerIds.indexOf(id)/2)+1}
export function officialSeason(history:HistoryMatch[],id:string){
 const finished=history.filter(m=>!m.manual&&!['ppl','ppl_ii'].includes((m.level??'').toLowerCase())&&m.status==='finished'&&(m.winner===1||m.winner===2))
 const wins=finished.filter(m=>playerWon(m,id)).length
 const titles=[...new Map(finished.filter(m=>m.tournamentId&&/^(f|final|finals)$/i.test(m.round??'')&&playerWon(m,id)).map(m=>[m.tournamentId,m])).values()]
 const months=[...new Set(finished.map(m=>m.date?.slice(0,7)).filter((d):d is string=>!!d))].sort().reverse().map(month=>{const rows=finished.filter(m=>m.date?.startsWith(month));return {month,wins:rows.filter(m=>playerWon(m,id)).length,total:rows.length}})
 return {wins,losses:finished.length-wins,total:finished.length,titles,months}
}
export function historyGroups(history:HistoryMatch[]){const groups=new Map<string,{key:string;name:string;matches:HistoryMatch[]}>();for(const m of history){const key=m.tournamentId??`${m.tournament}-${m.date?.slice(0,4)??m.id}`;if(!groups.has(key))groups.set(key,{key,name:m.tournament,matches:[]});groups.get(key)!.matches.push(m)}return [...groups.values()]}
export function historySearch(m:HistoryMatch,query:string){const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const text=normalize([m.tournament,m.round,m.date,m.date?new Date(m.date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Madrid'}):'',...m.names].join(' '));return normalize(query).trim().split(/\s+/).every(word=>text.includes(word))}

export function tournamentPage(requested:number,groupCount:number){return Math.min(Math.max(1,Math.ceil(groupCount/4)),Math.max(1,Math.floor(requested)||1))}

export function averageOfficialDuration(history:HistoryMatch[]){
 const minutes=history.filter(m=>!m.manual&&m.status==='finished').flatMap(m=>{
  const text=m.duration?.trim()
  if(!text||!/^\d{1,2}:[0-5]\d$/.test(text))return []
  const [h,min]=text.split(':').map(Number),value=h*60+min
  return value>0&&value<=240?[value]:[]
 })
 return {count:minutes.length,ms:minutes.length?minutes.reduce((a,b)=>a+b,0)/minutes.length*60000:null}
}

export function partnership(history:HistoryMatch[],player:string,partner:string){
 const together=history.filter(m=>{const i=m.playerIds.indexOf(player);return i>=0&&m.playerIds[i^1]===partner})
 const completed=together.filter(m=>m.status==='finished'&&(m.winner===1||m.winner===2))
 const wins=completed.filter(m=>playerWon(m,player)).length
 const last=together.filter(m=>m.status==='finished'&&m.date).sort((a,b)=>Date.parse(b.date!)-Date.parse(a.date!))[0]
 return {total:together.length,completed:completed.length,wins,losses:completed.length-wins,scouted:together.filter(m=>m.scouted).length,last}
}
