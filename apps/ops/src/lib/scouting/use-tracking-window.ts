'use client';
import {useEffect,useState} from 'react';
import type {AnalysisResult} from './use-analysis-result';
import type {TrackRow} from './movement-series';
import type {OverlayManifest} from './tracking-overlay';
// Share bounded requests between the video overlay and the 2D court.
const cache=new Map<string,Promise<unknown>>();
function asset(url:string,revision:string){
 const key=url+'@'+revision;let request=cache.get(key);
 if(!request){request=fetch(url,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Tracking could not load.');return r.json();}).catch(e=>{cache.delete(key);throw e;});cache.set(key,request);if(cache.size>24)cache.delete(cache.keys().next().value!);}
 return request;
}
export function useTrackingWindow(result:AnalysisResult|null,time:number,enabled=true){
 const bucket=Math.floor(time/60),key=result?result.id+':'+result.updatedAt+':'+result.assetBase+':'+bucket:'';
 const [state,setState]=useState<{key:string;rows:TrackRow[];manifest:OverlayManifest|null;error:string}>({key:'',rows:[],manifest:null,error:''});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!result||!enabled)return;let alive=true;
  setState({key,rows:[],manifest:null,error:''});
  (async()=>{try{
   const m=await asset(result.assetBase+'manifest.json',result.updatedAt) as OverlayManifest;
   const first=Math.max(Math.floor(m.start/60),bucket-1),last=Math.min(Math.ceil(m.end/60)-1,bucket+1);
   const chunks=await Promise.all(Array.from({length:Math.max(0,last-first+1)},(_,i)=>asset(result.assetBase+String(first+i).padStart(3,'0')+'.json',result.updatedAt)));
   const rows=chunks.flatMap(c=>{const rows=(c as {rows?:TrackRow[]}).rows;if(!Array.isArray(rows))throw Error('Invalid tracking package.');return rows;});
   if(alive)setState({key,rows,manifest:m,error:''});
  }catch(e){if(alive)setState({key,rows:[],manifest:null,error:e instanceof Error?e.message:'Tracking unavailable.'});}})();
  return()=>{alive=false;};
 },[key,enabled,retry]);
 return {...(enabled&&state.key===key?state:{rows:[],manifest:null,error:''}),loading:enabled&&(state.key!==key||!state.manifest&&!state.error),retry:()=>setRetry(n=>n+1)};
}
