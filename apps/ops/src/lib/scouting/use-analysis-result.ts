'use client'
import {useEffect,useState} from 'react'
export type AnalysisManifest={version:1;start:number;end:number;duration:number;partial:boolean;broadcastOffset:number;coverage:number[][];players:{key:string;id:string|null;name:string;team:number}[];performance:Record<string,any>;zoneSchema:any}
export type AnalysisResult={id:string;videoId:string;updatedAt:string;manifest:AnalysisManifest;assetBase:string}
export function useAnalysisResult(context?:{matchId:string;manual:boolean},videoId?:string){
 const [state,setState]=useState<{result:AnalysisResult|null;videoId:string|null;loaded:boolean}>({result:null,videoId:null,loaded:false})
 useEffect(()=>{setState({result:null,videoId:null,loaded:false});if(!context)return;let alive=true;const controller=new AbortController();
  const poll=async()=>{try{const r=await fetch(`/api/internal/lab-vision/results/${context.matchId}?kind=${context.manual?'manual':'canonical'}${videoId?'&video='+videoId:''}`,{cache:'no-store',signal:controller.signal});if(!r.ok)return;const d=await r.json();if(alive)setState({result:d.result,videoId:d.videoId,loaded:true})}catch{}};
  void poll();const timer=setInterval(poll,5000);return()=>{alive=false;controller.abort();clearInterval(timer)}
 },[context?.matchId,context?.manual,videoId]);return state
}
