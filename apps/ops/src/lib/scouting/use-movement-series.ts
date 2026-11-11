'use client';
import {useEffect,useState} from 'react';
import {movementSeries,type SpeedSample,type TrackRow} from './movement-series';
import {motionSeries,type MotionSample} from './movement-efforts';
import type {AnalysisResult} from './use-analysis-result';
const cache=new Map<string,{data:Record<string,SpeedSample[]>;motion:Record<string,MotionSample[]>}>();
export function useMovementSeries(result:AnalysisResult|null,enabled=true){
 const [state,setState]=useState<{data:Record<string,SpeedSample[]>|null;motion?:Record<string,MotionSample[]>;progress:number;error:string}>({data:null,progress:0,error:''});
 useEffect(()=>{setState({data:null,progress:0,error:''});if(!result||!enabled)return;
 const key=result.id+result.updatedAt;if(cache.has(key)){setState({...cache.get(key)!,progress:100,error:''});return;}
 const controller=new AbortController();let alive=true;
 (async()=>{try{const rows:TrackRow[]=[];const first=Math.floor(result.manifest.start/60),last=Math.ceil(result.manifest.end/60);
 for(let i=first;i<last;i+=3){const chunks=await Promise.all(Array.from({length:Math.min(3,last-i)},(_,j)=>fetch(result.assetBase+String(i+j).padStart(3,'0')+'.json',{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Tracking data could not load. Reopen Movement to retry.');return r.json();})));for(const c of chunks){if(!Array.isArray(c.rows))throw Error('Invalid tracking package');rows.push(...c.rows);}if(alive)setState({data:null,progress:Math.round((Math.min(i+3,last)-first)/(last-first)*100),error:''});}
 const data=movementSeries(rows,result.manifest.players.map(p=>p.key));if(!alive)return;const motion=motionSeries(rows,result.manifest.players.map(p=>p.key));cache.set(key,{data,motion});if(cache.size>3)cache.delete(cache.keys().next().value!);setState({data,motion,progress:100,error:''});
 }catch(e){if(alive)setState({data:null,progress:0,error:e instanceof Error?e.message:'Tracking unavailable'});}})();
 return()=>{alive=false;controller.abort();};
 },[result?.id,result?.updatedAt,enabled]);return state;
}
