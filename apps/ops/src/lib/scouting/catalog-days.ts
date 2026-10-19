export const CATALOG_TIME_ZONE='Europe/Madrid'
export function catalogDay(now=new Date()){
 return new Intl.DateTimeFormat('en-CA',{timeZone:CATALOG_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
}
export function catalogDays(today:string){
 const anchor=new Date(today+'T12:00:00Z')
 return Array.from({length:7},(_,i)=>{const d=new Date(anchor);d.setUTCDate(d.getUTCDate()+i-5);return {date:d.toISOString().slice(0,10),day:d.getUTCDate(),weekday:d.toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'}),label:i===4?'Yesterday':i===5?'Today':i===6?'Tomorrow':''}})
}
