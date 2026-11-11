export type ScoutShot={id:string;point:number;rallyId:string;index:number;sourceTime:number;playerId:string|null;playerName:string;shot:string;role:string;reason:string}
const labels:Record<string,string>={smash:'Smash',volley:'Volley',lob:'Lob',block:'Block',bandeja:'Bandeja',bajada:'Bajada',groundstroke:'Groundstroke',vibora:'Vibora',chiquita:'Chiquita',gancho:'Gancho',rulo:'Rulo',contrapared:'Contrapared',other:'Other'}
/** Keep operator taps and starts intact. They are proposals, never verified contacts. */
export function scoutingShots(d:any){
 if(!/^[0-9a-f-]{36}$/i.test(d?.matchId)||!Array.isArray(d?.originalDocument?.rallies)||!Array.isArray(d.players))throw Error('Invalid scouting export.')
 const shots:ScoutShot[]=[]
 d.originalDocument.rallies.forEach((r:any,i:number)=>{
  if(!/^[0-9a-f-]{36}$/i.test(r.id))throw Error('Invalid rally ID.')
  const push=(suffix:string,t:number,player:number|null,shot:string,role:string,reason:string,index:number)=>{
   if(!Number.isFinite(t)||t<0)return
   const p=player===null?null:d.players[player]
   shots.push({id:`scout:${d.matchId}:${r.id}:${suffix}`,point:i+1,rallyId:r.id,index,sourceTime:t,playerId:p?.id??null,playerName:p?.name??'',shot,role,reason})
  }
  // Only the first server is explicitly available here. Do not invent rotation for later points.
  push('start',r.start?.time,i===0?d.originalDocument.setup?.firstServer??null:null,'Serve','Serve','Point start; adjust to racket contact',0)
  ;(r.touches??[]).forEach((t:any,k:number)=>{
   const attempt=(r.attempts??[]).find((a:any)=>a.touchIndex===k&&a.player===t.player)
   const last=k===r.touches.length-1&&r.point?.player===t.player
   const label=attempt?'Smash':last?(labels[r.point?.shot]??'Unknown'):'Unknown'
   push('touch-'+k,t.snapshot?.time,t.player,label,last&&r.point?.shot==='return'?'Return of serve':'Unknown',attempt?'Scouted smash attempt':last?'Operator tap · ending-shot label from scout':'Operator tap · stroke needs review',k+1)
  })
 })
 return {matchId:d.matchId,points:d.originalDocument.rallies.length,touches:shots.filter(s=>s.index>0).length,firstStart:shots[0]?.sourceTime??0,shots,sourceUrl:d.originalDocument.setup?.videoSourceUrl??null}
}
