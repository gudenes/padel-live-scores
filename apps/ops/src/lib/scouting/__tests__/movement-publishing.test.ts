import {it,expect,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {movementSeries,type TrackRow} from '../movement-series';
import {motionSeries} from '../movement-efforts';
import {deriveMovement} from '../movement-cache';
import {parseMovementChunk} from '../movement-artifact';
import type {AnalysisResult} from '../use-analysis-result';
function close(a:any,b:any){if(typeof b==='number'){expect(a).toBeCloseTo(b,8);return;}if(Array.isArray(b)){expect(a).toHaveLength(b.length);b.forEach((v,i)=>close(a[i],v));return;}if(b&&typeof b==='object'){expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());for(const k of Object.keys(b))close(a[k],b[k]);return;}expect(a).toEqual(b);}
const result={id:'job',videoId:'video',updatedAt:'r1',assetBase:'/assets/',manifest:{start:59,end:63,players:[{key:'p0',id:'player'}],movement:{version:1,chunks:2,timebase:'source-video-seconds'}}} as AnalysisResult;
it('worker matches browser across minutes, gaps, cuts, inferred positions and jumps',()=>{
 const rows:TrackRow[]=Array.from({length:101},(_,i)=>({source_s:58+i/10,segment_id:i<50?1:2,overlay_visible:i!==72,players:{p0:{court_m:i===85?[100,100]:[2+i/100,15-Math.sin(i/10)],position_source:i===25?'inferred':'observed'}}})).filter((_,i)=>i!==34);
 const worker=resolve(process.cwd(),'../lab-vision-worker');
 const output=JSON.parse(execFileSync('python3',['-c',`import sys,json;sys.path.insert(0,${JSON.stringify(worker)});from movement_series import movement_chunks\nrows=json.load(sys.stdin);chunks={i:{'rows':[r for r in rows if int(r['source_s']//60)==i]} for i in (0,1)};print(json.dumps(movement_chunks(chunks,['p0'],58),allow_nan=False))`],{input:JSON.stringify(rows),encoding:'utf8'}));
 const data=Object.values(output).flatMap((c:any)=>parseMovementChunk(c,['p0']).data.p0),motion=Object.values(output).flatMap((c:any)=>parseMovementChunk(c,['p0']).motion.p0);
 close(data,movementSeries(rows,['p0']).p0);close(motion,motionSeries(rows,['p0']).p0);expect(motion.some(s=>s.start<60&&s.end>60)).toBe(true);
});
it('uses published samples without downloading raw tracking',async()=>{
 const value={version:1,data:{p0:[{time:59.5,duration:1,speed:7.2,distance:2,segment:1,zoneSeconds:[0,1,0],heat:{'2,15':1}}]},motion:{p0:[{time:59.5,start:59,end:59.8,x:2,y:15,speed:12,acceleration:1,run:1}]}};
 const fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('000')?value:{version:1,data:{p0:[]},motion:{p0:[]}}}));vi.stubGlobal('fetch',fetcher);
 try{expect(await deriveMovement(result,()=>{})).toEqual({data:value.data,motion:value.motion});expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/assets/movement-000.json','/assets/movement-001.json']);}finally{vi.unstubAllGlobals();}
});
it('falls back for invalid published artifacts',async()=>{
 const fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('movement-')?{version:99}:{rows:[]}}));vi.stubGlobal('fetch',fetcher);
 try{expect(await deriveMovement(result,()=>{})).toEqual({data:{p0:[]},motion:{p0:[]}});expect(fetcher.mock.calls.some(c=>c[0]==='/assets/000.json')).toBe(true);}finally{vi.unstubAllGlobals();}
});
it('rejects corrupt samples',()=>{expect(()=>parseMovementChunk({version:1,data:{p0:[]},motion:{p0:[{time:NaN}]}},['p0'])).toThrow();expect(()=>parseMovementChunk({version:1,data:{},motion:{}},['p0'])).toThrow();});
