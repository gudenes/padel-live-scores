import {anchorAlignment,movementReview,prepareReview} from '@/lib/lab-vision/prepare-review'
import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
import {estimateAnalysis} from '@/lib/scouting/analysis-estimate'
import {playbackVideo} from '@/lib/match-video-storage'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {jobBody} from '@/lib/lab-vision-jobs'
import {scoutingShots} from '@/lib/lab-vision/scouting-shots'
import {parseAnnotation} from '@/lib/lab-vision/annotations'
import {randomUUID} from 'node:crypto'
import {annotationProject, serveCandidates} from '@/lib/lab-vision/workspace-storage'
export const runtime='nodejs'
const json=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}})
async function access(){const u=(await auth())?.user;return u?.id&&u.isOperator?u:null}
async function analysis(id:string){if(!/^[0-9a-f-]{36}$/i.test(id))return null;return (await pgPool().query("select j.*,case when v.calibration_setup->'scoutingAnchor' is not null then j.setup || jsonb_build_object('scoutingAnchor',v.calibration_setup->'scoutingAnchor','offset',v.calibration_setup->'offset') else j.setup end as setup,v.file_name,v.duration_seconds,v.object_key,v.byte_size,v.broadcast_offset,v.id as upload_id,v.match_id,v.match_kind from lab_vision_jobs j join match_video_uploads v on v.id=j.video_id where j.id=$1",[id])).rows[0]}
export async function GET(req:Request){const u=await access();if(!u)return json({error:'Administrator access required.'},403)
 const id=new URL(req.url).searchParams.get('job')
 if(id){const j=await analysis(id);if(!j)return json({error:'Analysis not found.'},404)
 if(new URL(req.url).searchParams.get('shots')==='1'){
  try{
   const source=await annotationProject(j.match_id,j.match_kind);const project=scoutingShots(source)
   const savedAlignment=(await pgPool().query('select payload from lab_vision_annotation_alignments where job_id=$1',[id])).rows[0]?.payload??null
   const derived=anchorAlignment(j.setup,source);const alignment=(savedAlignment?.method!=='user-first-scouted-point'?savedAlignment:null)??(derived?{offset:derived.offsetSeconds,anchorVideoTime:j.setup.scoutingAnchor.videoTime}:null);return json({...project,alignment})
  }catch(e){return json({error:e instanceof Error?e.message:'Scouting-shot proposals unavailable.'},409)}
 }
 if(new URL(req.url).searchParams.get('candidates')==='1'){
  try{return json(await serveCandidates(j))}catch{return json({error:'Tracking proposals are unavailable for this run. Select a completed analysis.'},409)}
 }
 const annotations=(await pgPool().query('select payload from lab_vision_annotations where job_id=$1 order by created_at,id',[id])).rows.map(r=>r.payload)
 return json({movementReview:movementReview(j.result?.viewer?.manifest),tracking:j.result?.viewer?{manifest:j.result.viewer.manifest,assetBase:`/api/internal/lab-vision/assets/${j.id}/`}:null,video:await playbackVideo({...j,id:j.upload_id}),matchStart:j.setup?.matchStart??0,players:(j.setup?.playerNames??[]).map((name:string,i:number)=>({name,id:j.setup?.playerIds?.[i]??name})),annotations,source:{jobId:j.id,videoId:j.video_id,matchId:j.match_id,pipeline:j.result?.manifest?.pipeline??'Not recorded'}})}
 const {rows}=await pgPool().query('select j.id,j.video_id,j.worker_id,j.status,j.stage,j.progress,j.error,j.updated_at,j.setup,v.match_id,v.file_name from lab_vision_jobs j join match_video_uploads v on v.id=j.video_id order by j.created_at desc limit 50',[])
 const workers=(await pgPool().query("select id,last_seen_at,last_seen_at>now()-interval '45 seconds' as online from lab_vision_workers where revoked_at is null",[])).rows
 return json({jobs:rows.map(j=>({...j,estimate:estimateAnalysis(j)})),workers,checkedAt:new Date().toISOString()})
}
export async function POST(req:Request){const u=await access();if(!u)return json({error:'Administrator access required.'},403);if(!hasAdminRequestOrigin(req))return json({error:'Invalid origin.'},403)
 try{const b=await jobBody(req,12000);const j=await analysis(b.jobId);if(!j)return json({error:'Analysis not found.'},404)
 if(b.action==='prepare-review'){
  if(j.status!=='complete')return json({error:'Complete tracking first.'},409)
  const review=await prepareReview(j,j.result?.viewer?.manifest)
  await pgPool().query("update lab_vision_jobs set result=jsonb_set(result,'{review}',$2::jsonb) where id=$1",[j.id,JSON.stringify(review)])
  return json({review})
 }
 if(b.action==='align-shots'){
  if(!Number.isFinite(b.offset)||!Number.isFinite(b.anchorVideoTime)||b.anchorVideoTime<0||b.anchorVideoTime>Number(j.duration_seconds))throw Error('Invalid video anchor.')
  const source=scoutingShots(await annotationProject(j.match_id,j.match_kind))
  if(Math.abs(source.firstStart-b.anchorVideoTime-b.offset)>.001)throw Error('Anchor does not match first scouting point.')
  const alignment={offset:b.offset,anchorVideoTime:b.anchorVideoTime,confirmedAt:new Date().toISOString()}
  await pgPool().query('insert into lab_vision_annotation_alignments(job_id,payload,updated_by) values($1,$2,$3) on conflict(job_id) do update set payload=excluded.payload,updated_by=excluded.updated_by,updated_at=now()',[j.id,alignment,u.id]);return json({alignment})
 }
 const players=j.setup?.playerNames??[]
 const a=parseAnnotation(b,Number(j.duration_seconds),players)
 if(b.supersedes){if(!/^[0-9a-f-]{36}$/i.test(b.supersedes))throw Error('Invalid original annotation');const old=await pgPool().query('select id from lab_vision_annotations where id=$1 and job_id=$2',[b.supersedes,j.id]);if(!old.rowCount)return json({error:'Original annotation unavailable. Refresh and try again.',code:'missing_revision'},409)}
 const record={supersedes:b.supersedes||null,schemaVersion:a.participants?2:1,id:randomUUID(),...a,playerId:j.setup?.playerIds?.[(j.setup?.playerNames??[]).indexOf(a.player)]??null,jobId:j.id,videoId:j.video_id,matchId:j.match_id,reviewerId:u.id,createdAt:new Date().toISOString(),timebase:'source-video-seconds',origin:'human',trainingEligible:a.status==='verified'&&a.kind==='Shot contact'&&a.shot!=='Unknown'&&!!a.player,trainingStatus:'not_trained'}
 await pgPool().query('insert into lab_vision_annotations(id,job_id,reviewer_id,supersedes,payload,created_at) values($1,$2,$3,$4,$5,$6)',[record.id,j.id,u.id,record.supersedes,record,record.createdAt]);return json({annotation:record})
 }catch(e){if((e as {code?:string}).code==='23505')return json({error:'This annotation was already revised. Refresh before saving.',code:'revision_conflict'},409);return json({error:e instanceof Error?e.message:'Unable to save annotation'},400)}
}
