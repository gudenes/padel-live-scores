const DAY=86400000
/** Madrid calendar weeks, including 23/25-hour daylight-saving days. */
export function leaderboardWeek(offset=0,now=new Date()) {
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
 const today=new Date(`${date}T00:00:00Z`)
 const monday=today.getTime()-((today.getUTCDay()+6)%7+offset*7)*DAY
 function midnight(day:number) {
  let instant=day
  for(let i=0;i<3;i++) {
   const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant))
   const p=Object.fromEntries(parts.map(p=>[p.type,p.value]))
   const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)
   instant+=day-local
  }
  return new Date(instant).toISOString()
 }
 return {start:midnight(monday),end:midnight(monday+7*DAY),labelStart:new Date(monday).toISOString(),labelEnd:new Date(monday+6*DAY).toISOString()}
}
