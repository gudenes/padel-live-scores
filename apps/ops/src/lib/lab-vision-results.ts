import {validScoutingAlignment} from './scouting/scouting-alignment';
/** Publication contract. Worker results become visible only after all files exist. */
export const viewerFile=/^(manifest|\d{3,4})\.json$/
export function viewerAssets(input:any,end:number){
 const count=Math.ceil(end/60)
 if(input?.version!==1||!Number.isFinite(end)||end<=0||count>1440||!Array.isArray(input.assets)||input.assets.length!==count+1)throw Error('Incomplete viewer package.')
 const expected=new Set(['manifest.json',...Array.from({length:count},(_,i)=>`${String(i).padStart(3,'0')}.json`)])
 for(const a of input.assets){if(!expected.delete(a.file)||!Number.isSafeInteger(a.size)||a.size<=0||a.size>24*1024*1024)throw Error('Invalid viewer file.');}
 return input.assets as {file:string;size:number}[]
}
export function validateViewerManifest(m:any,setup:any){
 const end=Math.min(setup.duration,setup.matchStart+setup.analysisSeconds)
 if(m?.version!==1||m.start!==setup.matchStart||m.end!==end||m.duration!==setup.duration||m.broadcastOffset!==setup.offset||m.chunks!==Math.ceil(end/60)||m.chunkSeconds!==60)throw Error('Viewer timing does not match this analysis.')
 if(m.partial!==(end<setup.duration-.1)||!Array.isArray(m.sourceDimensions)||m.sourceDimensions.length!==2||m.sourceDimensions.some((n:any)=>!Number.isFinite(n)||n<=0||n>16000))throw Error('Invalid source metadata.')
 if(!Array.isArray(m.players)||m.players.length!==4||m.players.some((p:any,i:number)=>p.key!==`p${i}`||p.name!==setup.playerNames[i]||p.id!==(setup.playerIds?.[i]??null)||p.team!==Math.floor(i/2)))throw Error('Viewer identities do not match this analysis.')
 if(!Array.isArray(m.coverage)||m.coverage.length>20000||m.coverage.some((v:any)=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)||v[0]<m.start||v[1]>end+.11||v[1]<v[0]))throw Error('Invalid coverage.')
 if(!Array.isArray(m.inverseHomography)||m.inverseHomography.length!==3||m.inverseHomography.some((r:any)=>!Array.isArray(r)||r.length!==3||!r.every(Number.isFinite)))throw Error('Invalid court calibration.')
 for(const p of m.players){const v=m.performance?.[p.key];if(!v||!Number.isFinite(v.distance_m)||v.distance_m<0||['max_speed_kmh','average_speed_kmh'].some(k=>v[k]!==null&&(!Number.isFinite(v[k])||v[k]<0||v[k]>50)))throw Error('Invalid performance metrics.')}
 if(m.scoutingAlignment!==undefined){
  const a=m.scoutingAlignment;
  if(!validScoutingAlignment(a))throw Error('Invalid scouting alignment.');
 }
 if(m.activity!==undefined){
  const a=m.activity;
  if(a.version!==1||a.timebase!=='source-video-seconds'||!Array.isArray(a.windows)||a.windows.length>20000||!Number.isFinite(a.duration)||a.duration<0||a.windows.some((w:any,i:number)=>!Number.isFinite(w.start)||!Number.isFinite(w.end)||!Number.isFinite(w.segment)||w.end<=w.start||w.start<m.start||w.end>end+.11||(i>0&&w.start<a.windows[i-1].end)||!m.coverage.some((c:number[])=>c[2]===w.segment&&w.start>=c[0]&&w.end<=c[1]+.01)))throw Error('Invalid activity windows.');
 }
 return m
}
