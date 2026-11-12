import {pgPool} from '@/lib/db'
import {scoutingShots} from './scouting-shots'
import type {VideoSetup} from '@/lib/scouting/video-setup'

/** Read the saved scout directly; no separate JSON import is required. */
export async function savedScout(matchId:string,kind:string,db:any=pgPool()){
 const table=kind==='manual'?'operator_manual_video_scouting_sessions':'operator_video_scouting_sessions'
 const row=(await db.query(`select document,players from public.${table} where match_id=$1`,[matchId])).rows[0]
 return row?{matchId,players:row.players,originalDocument:row.document}:null
}
export function anchorAlignment(setup:VideoSetup,source:any){
 const a=setup.scoutingAnchor;if(!a)return null
 const first=source?.originalDocument?.rallies?.find((r:any)=>Number.isFinite(r.start?.time))
 if(!first||first.id!==a.rallyId||Math.abs(first.start.time-a.sourceTime)>.001)throw Error('Scouting changed. Confirm the first point in video setup again.')
 if(!Number.isFinite(a.videoTime)||a.videoTime<0||a.videoTime>=setup.duration||Math.abs(setup.offset-(a.sourceTime-a.videoTime))>.001)throw Error('Invalid scouting anchor.')
 return {version:1 as const,offsetSeconds:setup.offset,method:'user-first-scouted-point'}
}
/** Summary of existing tracking, not a claim of verified identity or biomechanics. */
export function movementReview(manifest:any){
 const span=Math.max(0,(manifest?.end??0)-(manifest?.start??0))
 return {status:manifest?'available_for_review':'unavailable',timebase:'source-video-seconds',identity:'requires_human_review',players:(manifest?.players??[]).map((p:any)=>{
  const m=manifest?.performance?.[p.key]??{};
  return {id:p.id,key:p.key,name:p.name,observedSeconds:m.observed_s??null,inferredSeconds:m.inferred_s??null,observedShare:span&&Number.isFinite(m.observed_s)?Math.min(1,m.observed_s/span):null,distanceM:m.distance_m??null,peakSpeedKmh:m.max_speed_kmh??null}
 })}
}
/** Idempotent preparation. Never overwrites imported projects, alignment corrections or labels. */
export async function prepareReview(job:any,manifest:any,db:any=pgPool()){
 const video=(await db.query('select match_id,match_kind from match_video_uploads where id=$1',[job.video_id])).rows[0]
 if(!video)throw Error('Video unavailable')
 const source=await savedScout(video.match_id,video.match_kind,db)
 const movement=movementReview(manifest)
 if(!source)return {status:'scouting_unavailable',movement}
 const project=scoutingShots(source),alignment=anchorAlignment(job.setup,source)
 await db.query('insert into lab_vision_annotation_projects(match_id,source) values($1,$2) on conflict(match_id) do nothing',[video.match_id,source])
 if(alignment)await db.query('insert into lab_vision_annotation_alignments(job_id,payload,updated_by) values($1,$2,$3) on conflict(job_id) do nothing',[job.id,{offset:alignment.offsetSeconds,anchorVideoTime:job.setup.scoutingAnchor.videoTime,confirmedAt:new Date().toISOString(),method:alignment.method},job.owner_user_id])
 return {status:alignment?'ready':'alignment_required',proposalCount:project.shots.length,points:project.points,movement}
}
