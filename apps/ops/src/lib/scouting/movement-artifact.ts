import type {MovementData} from './movement-cache';
import type {AnalysisResult} from './use-analysis-result';
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
/** Validate before saving a server artifact in the persistent browser cache. */
export function parseMovementChunk(input:any,keys:string[]):MovementData{
 if(input?.version!==1||!input.data||!input.motion)throw Error('Invalid saved movement data.');
 for(const key of keys){
  const speed=input.data[key],motion=input.motion[key];
  if(!Array.isArray(speed)||!Array.isArray(motion)||speed.length>10000||motion.length>20000)throw Error('Invalid saved movement samples.');
  if(speed.some((s:any)=>!s||!['time','duration','speed','distance','segment'].every(k=>finite(s[k]))||s.duration<=0||s.speed<0||s.speed>30||s.distance<0||!Array.isArray(s.zoneSeconds)||s.zoneSeconds.length!==3||!s.zoneSeconds.every(finite)||!s.heat||typeof s.heat!=='object'||!Object.values(s.heat).every(finite)))throw Error('Invalid saved speed samples.');
  if(motion.some((s:any)=>!s||!['time','start','end','x','y','speed','run'].every(k=>finite(s[k]))||s.start>s.time||s.end<s.time||s.speed<0||s.speed>30||(s.acceleration!==null&&(!finite(s.acceleration)||Math.abs(s.acceleration)>12))))throw Error('Invalid saved motion samples.');
 }
 return {data:input.data,motion:input.motion};
}
export async function loadSavedMovement(result:AnalysisResult,progress:(n:number)=>void):Promise<MovementData>{
 const keys=result.manifest.players.map(p=>p.key),data:MovementData={data:{},motion:{}};
 for(const key of keys){data.data[key]=[];data.motion[key]=[];}
 const first=Math.floor(result.manifest.start/60),last=Math.ceil(result.manifest.end/60);
 for(let i=first;i<last;i+=3){
  const chunks=await Promise.all(Array.from({length:Math.min(3,last-i)},(_,j)=>fetch(result.assetBase+'movement-'+String(i+j).padStart(3,'0')+'.json').then(async r=>{
   if(!r.ok)throw Error('Saved movement data could not load.');return parseMovementChunk(await r.json(),keys);
  })));
  for(const chunk of chunks)for(const key of keys){data.data[key].push(...chunk.data[key]);data.motion[key].push(...chunk.motion[key]);}
  progress(Math.round((Math.min(i+3,last)-first)/(last-first)*95));
 }
 return data;
}
