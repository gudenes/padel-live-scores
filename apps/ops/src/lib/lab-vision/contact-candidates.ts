import {proposeBox} from './propose-box'
export const candidateMethod='pose-wrist-peaks-v1'
/** Review candidates only: wrist speed peaks are not detected racket/ball contacts. */
export function contactCandidates(m:any,chunks:any[]){
 const frames=chunks.flatMap(c=>c.poses??[]).sort((a,b)=>a.t-b.t),rows=chunks.flatMap(c=>c.rows??[]).sort((a,b)=>a.source_s-b.source_s)
 const raw:any[]=[];let ri=0,ci=0
 const good=(p:any)=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&p[2]>=.4
 for(let i=4;i<frames.length;i++){
  const a=frames[i-4],b=frames[i],dt=b.t-a.t;if(dt<=0||dt>.18)continue
  while(ci<m.coverage.length&&m.coverage[ci][1]<b.t)ci++
  const seg=m.coverage[ci];if(!seg||a.t<seg[0]||b.t>seg[1])continue
  while(ri+1<rows.length&&rows[ri+1].source_s<=b.t)ri++
  const row=rows[ri];if(!row||!row.overlay_visible||b.t-row.source_s>.15||row.segment_id!==seg[2])continue
  for(const p of m.players){
   const k=b.players[p.key],prev=a.players[p.key],position=row.players?.[p.key];if(!k||!prev||position?.position_source!=='observed')continue
   if(![5,6,11,12].every(j=>good(k[j])&&good(prev[j])))continue
   const center=(j:any)=>[(j[5][0]+j[6][0]+j[11][0]+j[12][0])/4,(j[5][1]+j[6][1]+j[11][1]+j[12][1])/4]
   const c=center(k),c0=center(prev),scale=Math.hypot((k[5][0]+k[6][0]-k[11][0]-k[12][0])/2,(k[5][1]+k[6][1]-k[11][1]-k[12][1])/2);if(scale<8)continue
   let speed=0,wrist=-1
   for(const j of [9,10])if(good(k[j])&&good(prev[j])){const s=Math.hypot(k[j][0]-c[0]-prev[j][0]+c0[0],k[j][1]-c[1]-prev[j][1]+c0[1])/scale/dt;if(s>speed){speed=s;wrist=j}}
   if(speed<4.5||speed>35)continue
   const y=position.court_m?.[1],deep=Number.isFinite(y)&&(y<=3.5||y>=16.5),low=wrist>=0&&k[wrist][1]>=(k[11][1]+k[12][1])/2-scale*.35
   raw.push({time:b.t,player:p.name,key:p.key,score:speed,serveHint:deep&&low,segment:seg[2],frame:b})
  }
 }
 // Keep distinct swings for each player; duplicate adjacent speed peaks are suppressed.
 const accepted:any[]=[],byPlayer=new Map<string,any[]>()
 for(const r of raw.sort((a,b)=>b.score-a.score)){const list=byPlayer.get(r.key)??[];if(list.some(a=>a.segment===r.segment&&Math.abs(a.time-r.time)<.8))continue;list.push(r);byPlayer.set(r.key,list);accepted.push(r)}
 return accepted.sort((a,b)=>a.time-b.time).map(r=>({id:`${candidateMethod}:${r.key}:${r.time.toFixed(3)}`,time:r.time,player:r.player,key:r.key,serveHint:r.serveHint,method:candidateMethod,reason:r.serveHint?'Wrist motion peak · deep court position · low hand':'Wrist motion peak',box:proposeBox(m,[r.frame],r.time,r.key)?.box??null}))
}
