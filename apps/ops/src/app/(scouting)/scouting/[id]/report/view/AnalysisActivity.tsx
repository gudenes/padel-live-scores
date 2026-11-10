'use client'
import {useEffect,useRef,useState} from 'react'
import {analysisProgress,analysisStages,type AnalysisProgressJob} from '@/lib/scouting/analysis-progress'
import type {AnalysisEstimate} from '@/lib/scouting/analysis-estimate'
import {CheckCircle} from './Icons'
type Job=AnalysisProgressJob&{id?:string;updated_at?:string;estimate?:AnalysisEstimate|null}
const descriptions:Record<string,string>={queued:'Waiting for the connected computer to pick up this match.',downloading:'Transferring the uploaded video to your computer for analysis.',normalizing:'Preparing a consistent 30 fps video for player and ball tracking.',preparing:'Checking your court calibration and matching the four players.',players:'Following player positions and poses through the match.',movement:'Calculating distance, speed, court zones and active play.',ball:'Following the ball through the video with WASB.',refinement:'Checking ball detections and refining the trajectory.',uploading:'Uploading results and connecting the 3D court and player statistics.'}
export function remainingLabel(seconds:number){const minutes=Math.max(1,Math.ceil(seconds/60));return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)}h ${minutes%60}m`}
export default function AnalysisActivity({job,online,pollError=false,previewEstimate}:{job?:Job|null;online:boolean;pollError?:boolean;previewEstimate?:string}){
 const view=analysisProgress(job),[now,setNow]=useState(Date.now());
 const sample=useRef<{key:string;time:number;processed:number}|null>(null)
 const key=`${job?.id}:${job?.stage}`,processed=job?.progress?.processed,total=job?.progress?.total
 useEffect(()=>{if(Number.isFinite(processed)&&sample.current?.key!==key)sample.current={key,time:Date.now(),processed:processed!}},[key,processed])
 useEffect(()=>{if(!view.active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[view.active])
 if(!job)return null
 const age=job.updated_at?Math.max(0,Math.floor((now-Date.parse(job.updated_at))/1000)):null
 const stalled=!!pollError||!online||(age!==null&&age>45)
 const baseline=sample.current,elapsed=baseline?.key===key?(now-baseline.time)/1000:0,delta=baseline?.key===key&&processed!==undefined?processed-baseline.processed:0
 const eta=!stalled&&elapsed>=20&&delta>0&&total!==undefined&&processed!==undefined?(total-processed)/(delta/elapsed):null
 const detail=job.stage==='downloading'&&total&&processed!==undefined?`${(processed/1e9).toFixed(2)} / ${(total/1e9).toFixed(2)} GB downloaded`:['players','ball'].includes(job.stage)&&total&&processed!==undefined?`${remainingLabel(processed)} of ${remainingLabel(total)} video analyzed`:null
 return <div className="va-activity" data-stalled={stalled}>
 {view.active&&<><div className="va-activity-heading"><span className="va-activity-spinner" aria-hidden="true"/><strong>{stalled?'Waiting for an update':job.status==='queued'?'Queued':view.label}</strong>{view.percent!==null&&<b>{view.percent}%</b>}</div>
 <p>{descriptions[job.stage]??'Processing your match.'}</p>
 <progress aria-label={`${view.label} progress`} max={100} value={view.percent??undefined}/>
 <div className="va-activity-detail"><span>{detail??'This step does not report a percentage yet.'}</span>{eta!==null&&eta>0&&<span>~{remainingLabel(eta)} this step</span>}</div>
 <div className="va-finish"><span>Estimated time remaining · entire analysis</span><strong>{!stalled&&job.estimate?`About ${remainingLabel(job.estimate.lowSeconds)} – ${remainingLabel(job.estimate.highSeconds)}`:previewEstimate??(stalled?'Waiting for worker…':'Calculating estimate…')}</strong><p>{!stalled&&job.estimate?`Based on ${job.estimate.matches} completed matches · ${job.estimate.blocks} processing blocks.${job.estimate.live?' Adjusted to current speed.':''} Includes an allowance for preparation and publishing.`:previewEstimate?'Preview only · example timing, not a live prediction.':'Waiting for a recent worker update and a matching processing history.'}</p></div>
 <p className="va-heartbeat"><i/>{stalled?'Updates delayed · progress is preserved':age===null?'Connected · waiting for first update':`Worker updated ${age<5?'just now':`${age}s ago`}`}</p></>}
 <ol className="va-stages">{analysisStages.map((label,i)=>{const done=job.status==='complete'||i<view.index,current=view.active&&i===view.index;return <li key={label} data-state={done?'done':current?'active':'pending'} data-stalled={stalled}>{done?<CheckCircle/>:<span className="va-stage-marker"/>}<span>{label}</span><small>{done?'Complete':current?(stalled?'Waiting':'In progress'):job.status==='failed'&&i===view.index?'Stopped':'Pending'}</small></li>})}</ol>
 </div>
}
