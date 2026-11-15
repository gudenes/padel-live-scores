import {movementSeries,type SpeedSample,type TrackRow} from './movement-series';
import {motionSeries,type MotionSample} from './movement-efforts';
import {loadSavedMovement} from './movement-artifact';
import type {AnalysisResult} from './use-analysis-result';

// Bump when either derivation changes. Scouting filters/alignment do not change
// these source-video samples; their summaries are applied separately by consumers.
export const MOVEMENT_CACHE_VERSION=1;
export type MovementData={data:Record<string,SpeedSample[]>;motion:Record<string,MotionSample[]>};
export interface MovementStore {
 read(key:string):Promise<MovementData|null>;
 write(key:string,value:MovementData):Promise<void>;
}
export function movementCacheKey(result:AnalysisResult){
 return JSON.stringify([MOVEMENT_CACHE_VERSION,result.id,result.videoId,result.updatedAt,result.assetBase,result.manifest.start,result.manifest.end,result.manifest.players.map(p=>[p.key,p.id]),result.manifest.movement??null]);
}
export async function deriveMovement(result:AnalysisResult,progress:(n:number)=>void):Promise<MovementData>{
 if(result.manifest.movement?.version===MOVEMENT_CACHE_VERSION){
  try{const saved=await loadSavedMovement(result,progress);if(process.env.NODE_ENV==='development')console.debug('Movement cache: loaded published samples without derivation',result.id);return saved;}catch{
   // Older/incomplete packages remain usable through the observed-tracking fallback.
   progress(0);
  }
 }
 const rows:TrackRow[]=[],first=Math.floor(result.manifest.start/60),last=Math.ceil(result.manifest.end/60);
 for(let i=first;i<last;i+=3){
  const chunks=await Promise.all(Array.from({length:Math.min(3,last-i)},(_,j)=>fetch(result.assetBase+String(i+j).padStart(3,'0')+'.json').then(async r=>{
   if(!r.ok)throw Error('Tracking data could not load. Reopen Movement to retry.');
   const chunk=await r.json();if(!Array.isArray(chunk.rows))throw Error('Invalid tracking package');return chunk.rows as TrackRow[];
  })));
  for(const chunk of chunks)rows.push(...chunk);
  progress(Math.round((Math.min(i+3,last)-first)/(last-first)*95));
 }
 const keys=result.manifest.players.map(p=>p.key);
 return {data:movementSeries(rows,keys),motion:motionSeries(rows,keys)};
}
/** One load per analysis shared by all mounted views. A departing subscriber
 * does not cancel work needed by another view (or prevent saving it for later). */
export function createMovementLoader(store:MovementStore,derive=deriveMovement){
 const memory=new Map<string,MovementData>();
 const pending=new Map<string,{promise:Promise<MovementData>;progress:number;listeners:Set<(n:number)=>void>}>();
 return function load(result:AnalysisResult,onProgress:(n:number)=>void=()=>{}){
  const key=movementCacheKey(result),cached=memory.get(key);
  if(cached){memory.delete(key);memory.set(key,cached);return {promise:Promise.resolve(cached),unsubscribe:()=>{}};}
  let job=pending.get(key);
  if(!job){
   const listeners=new Set<(n:number)=>void>();
   const created={promise:null as unknown as Promise<MovementData>,progress:0,listeners};
   pending.set(key,created);
   created.promise=(async()=>{
    let value:MovementData|null=null;
    try{value=await store.read(key);if(value&&process.env.NODE_ENV==='development')console.debug('Movement cache: restored saved analysis',result.id);}catch{/* Storage is optional (private mode, eviction, quota). */}
    if(!value){
     value=await derive(result,n=>{created.progress=n;for(const listener of listeners)listener(n);});
     try{await store.write(key,value);if(process.env.NODE_ENV==='development')console.debug('Movement cache: saved derived analysis',result.id);}catch{/* Keep usable in memory even if persistence fails. */}
    }
    memory.set(key,value);while(memory.size>3)memory.delete(memory.keys().next().value!);
    return value;
   })().finally(()=>{pending.delete(key);listeners.clear();});
   job=created;
  }
  job.listeners.add(onProgress);onProgress(job.progress);
  return {promise:job.promise,unsubscribe:()=>job.listeners.delete(onProgress)};
 };
}
