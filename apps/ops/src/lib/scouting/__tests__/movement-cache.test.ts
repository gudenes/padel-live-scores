import {describe,it,expect,vi} from 'vitest';
import {createMovementLoader,movementCacheKey,deriveMovement,type MovementData,type MovementStore} from '../movement-cache';
import type {AnalysisResult} from '../use-analysis-result';
const result={id:'job',videoId:'video',updatedAt:'revision-1',assetBase:'/tracking/',manifest:{start:0,end:60,players:[{key:'p0',id:'player'}]}} as AnalysisResult;
const data:MovementData={data:{p0:[]},motion:{p0:[]}};
function storage(){const disk=new Map<string,MovementData>();return {read:vi.fn(async(key:string)=>disk.get(key)??null),write:vi.fn(async(key:string,value:MovementData)=>{disk.set(key,value);})};}
describe('shared persistent movement cache',()=>{
 it('shares concurrent calculation and progress without cancelling other subscribers',async()=>{
  const store=storage();let finish!:(value:MovementData)=>void;let report!:(n:number)=>void;
  const derive=vi.fn(async(_result:AnalysisResult,progress:(n:number)=>void)=>{report=progress;return new Promise<MovementData>(resolve=>{finish=resolve;});});
  const load=createMovementLoader(store,derive),a=vi.fn(),b=vi.fn();
  const first=load(result,a),second=load(result,b);await Promise.resolve();
  expect(derive).toHaveBeenCalledTimes(1);expect(store.read).toHaveBeenCalledTimes(1);
  report(50);expect(a).toHaveBeenLastCalledWith(50);expect(b).toHaveBeenLastCalledWith(50);
  first.unsubscribe();report(95);expect(a).toHaveBeenLastCalledWith(50);expect(b).toHaveBeenLastCalledWith(95);
  finish(data);expect(await second.promise).toBe(data);expect(await first.promise).toBe(data);
  expect(store.write).toHaveBeenCalledTimes(1);
  expect(await load(result).promise).toBe(data);expect(store.read).toHaveBeenCalledTimes(1);
 });
 it('reuses saved results in a fresh loader without calculating again',async()=>{
  const store=storage(),derive=vi.fn(async()=>data);
  await createMovementLoader(store,derive)(result).promise;
  const nextDerive=vi.fn(async()=>{throw Error('Must not recalculate');});
  expect(await createMovementLoader(store,nextDerive)(result).promise).toEqual(data);expect(nextDerive).not.toHaveBeenCalled();
 });
 it('invalidates changed source inputs but ignores display names and rally alignment',()=>{
  const key=movementCacheKey(result);
  for(const changed of [{...result,updatedAt:'revision-2'},{...result,videoId:'other'},{...result,assetBase:'/new/'},{...result,manifest:{...result.manifest,end:120}},{...result,manifest:{...result.manifest,players:[{...result.manifest.players[0],id:'corrected'}]}}])expect(movementCacheKey(changed)).not.toBe(key);
  expect(movementCacheKey({...result,manifest:{...result.manifest,players:[{...result.manifest.players[0],name:'Updated label'}]}})).toBe(key);
 });
 it('remains usable if persistent reads and writes fail',async()=>{
  const store:MovementStore={read:async()=>{throw Error('blocked');},write:async()=>{throw Error('quota');}};
  const derive=vi.fn(async()=>data),load=createMovementLoader(store,derive);
  expect(await load(result).promise).toBe(data);expect(await load(result).promise).toBe(data);expect(derive).toHaveBeenCalledTimes(1);
 });
 it('does not cache failed calculation and permits retry',async()=>{
  const store=storage(),derive=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(data),load=createMovementLoader(store,derive);
  await expect(load(result).promise).rejects.toThrow('offline');expect(store.write).not.toHaveBeenCalled();
  expect(await load(result).promise).toBe(data);expect(derive).toHaveBeenCalledTimes(2);
 });
 it('preserves derived speed and motion values',async()=>{
  const rows=Array.from({length:31},(_,i)=>({source_s:i/10,segment_id:1,overlay_visible:true,players:{p0:{court_m:[2+i/10,15],position_source:'observed'}}}));
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>({rows})}));vi.stubGlobal('fetch',fetcher);
  try{const value=await deriveMovement(result,()=>{});expect(fetcher).toHaveBeenCalledTimes(1);expect(value.data.p0[0].speed).toBeCloseTo(3.6);expect(value.motion.p0[0].speed).toBeCloseTo(3.6);}finally{vi.unstubAllGlobals();}
 });
});
