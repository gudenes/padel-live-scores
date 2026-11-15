import {videoUuid} from '../match-video'
export type MatchVideoStatus='ready'|'processing'
export type VideoStatusDetail={state:MatchVideoStatus|'queued';position?:number;percent?:number;stage?:string;owned?:boolean}
export type VideoQueueItem={id:string;matchId:string;kind:string;name:string;state:'queued'|'processing';position?:number;percent?:number;stage?:string;online:boolean}
export function stagePercent(progress:{processed?:number;total?:number}|null):number|undefined{const done=progress?.processed,total=progress?.total;return Number.isFinite(done)&&Number.isFinite(total)&&total!>0?Math.round(Math.max(0,Math.min(1,done!/total!))*100):undefined}
export const analysisStageName=(stage?:string)=>({preparing:'Preparing',downloading:'Downloading video',normalizing:'Preparing video',players:'Tracking players',movement:'Calculating movement',ball:'Tracking ball',refinement:'Refining tracking',uploading:'Publishing results'}[stage??'']??'Preparing')
export function videoStatusLabel(s:VideoStatusDetail){return s.state==='ready'?'Video ready':s.state==='queued'?`Queued${s.position?' · #'+s.position:''}`:`Processing${s.percent!=null?' · '+s.percent+'%':''}`}
export const matchVideoKey=(m:{id:string;manual:boolean})=>`${m.manual?'manual':'canonical'}:${m.id}`
export function parseVideoStatusMatches(value:string){
 const keys=[...new Set(value.split(',').filter(Boolean))]
 if(keys.length>200)throw Error('Too many matches.')
 return keys.map(key=>{const [kind,id,...rest]=key.split(':');if(rest.length||!['canonical','manual'].includes(kind)||!videoUuid.test(id??''))throw Error('Invalid match.');return {kind,id}})
}
/** Keep a published result available while another analysis of that video runs. */
export function matchVideoStatus(ready:boolean,active:boolean):MatchVideoStatus|null{return ready?'ready':active?'processing':null}
