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

/** Keep weeks with either participation or scored results, including zero scores. */
export function activeLeaderboardWeeks(activityDates: string[], now = new Date()) {
 const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'})
 const monday = (date: Date) => {
  const day = new Date(`${formatter.format(date)}T00:00:00Z`)
  return day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY
 }
 const current = monday(now)
 // Reuse one formatter; history can contain many trades on the same day.
 const offsets = new Set<number>()
 // Madrid's day boundaries and DST changes fall on whole UTC hours. Reuse
 // their week conversion instead of formatting every individual trade timestamp.
 const hourOffsets = new Map<number,number>()
 for (const date of new Set(activityDates)) {
  const instant = new Date(date)
  if (!Number.isFinite(instant.getTime())) continue
  const hour=Math.floor(instant.getTime()/3600000)
  let offset=hourOffsets.get(hour)
  if(offset===undefined){offset=Math.round((current-monday(instant))/(7*DAY));hourOffsets.set(hour,offset)}
  if (offset >= 0 && offset <= 520) offsets.add(offset)
 }
 return [...offsets].sort((a,b) => a-b)
}

export function selectLeaderboardWeek(available: number[], requested: number) {
 const offset = available.find(offset => offset >= requested) ?? available.at(-1) ?? 0
 const index = available.indexOf(offset)
 return { weekOffset: offset, previousWeek: available[index + 1] ?? null, nextWeek: index > 0 ? available[index - 1] : null }
}
