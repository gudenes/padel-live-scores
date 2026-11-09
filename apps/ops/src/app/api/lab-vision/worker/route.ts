import {createHash,randomUUID} from 'node:crypto'
import {isUserOperator} from '@/lib/operators'
import {pgPool} from '@/lib/db'
import {jobBody,jobJson as json} from '@/lib/lab-vision-jobs'
import {videoStorage,playbackVideo} from '@/lib/match-video-storage'
import {PutObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3'
import {getSignedUrl} from '@aws-sdk/s3-request-presigner'
import {videoUuid} from '@/lib/scouting/match-video'
export const runtime='nodejs'
export async function POST(req:Request){
 const token=req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return json({error:'Worker credential required.'},401)
 const db=pgPool(),worker=(await db.query('select * from public.lab_vision_workers where token_hash=$1 and revoked_at is null',[createHash('sha256').update(token).digest('hex')])).rows[0];if(!worker||!await isUserOperator(worker.owner_user_id))return json({error:'Worker disconnected.'},401)
 let b;try{b=await jobBody(req,100000)}catch{return json({error:'Invalid request.'},400)}
 await db.query('update public.lab_vision_workers set last_seen_at=now() where id=$1',[worker.id])
 if(b.action==='claim'){
  const c=await db.connect();let job;
  try{await c.query('begin');await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[worker.id]);
   const current=await c.query("select * from public.lab_vision_jobs where worker_id=$1 and status='running' and lease_until>now() limit 1 for update",[worker.id]);
   if(current.rows[0])job=current.rows[0];else{
    const row=(await c.query("select * from public.lab_vision_jobs where owner_user_id=$1 and (status='queued' or (status='running' and lease_until<now())) order by created_at for update skip locked limit 1",[worker.owner_user_id])).rows[0];
    if(row)job=(await c.query("update public.lab_vision_jobs set worker_id=$2,attempt_id=$3,status='running',stage='preparing',lease_until=now()+interval '2 minutes',updated_at=now() where id=$1 returning *",[row.id,worker.id,randomUUID()])).rows[0]
   }await c.query('commit')
  }catch(e){await c.query('rollback');throw e}finally{c.release()}
  if(!job)return json({job:null});const video=(await db.query("select * from public.match_video_uploads where id=$1 and status='ready'",[job.video_id])).rows[0];if(!video)return json({error:'Video is no longer available.'},409)
  return json({job:{id:job.id,attemptId:job.attempt_id,setup:job.setup,video:await playbackVideo(video)}})
 }
 if(!videoUuid.test(b.id??'')||!videoUuid.test(b.attemptId??''))return json({error:'Invalid job.'},400)
 const job=(await db.query("select * from public.lab_vision_jobs where id=$1 and owner_user_id=$2 and worker_id=$3 and attempt_id=$4 and status='running' and lease_until>now()",[b.id,worker.owner_user_id,worker.id,b.attemptId])).rows[0];if(!job)return json({error:'Job stopped or lease expired.'},409)
 if(b.action==='heartbeat'){
  const stages=['preparing','downloading','normalizing','players','movement','ball','refinement','uploading'];if(!stages.includes(b.stage))return json({error:'Invalid stage.'},400)
  const progress={processed:Number(b.processed)||0,total:Number(b.total)||0};if(!Object.values(progress).every(n=>Number.isFinite(n)&&n>=0))return json({error:'Invalid progress.'},400)
  await db.query("update public.lab_vision_jobs set stage=$2,progress=$3,lease_until=now()+interval '2 minutes',updated_at=now() where id=$1 and status='running' and attempt_id=$4",[job.id,b.stage,progress,b.attemptId]);return json({ok:true})
 }
 if(b.action==='failed'){
  await db.query("update public.lab_vision_jobs set status='failed',error=$2,updated_at=now() where id=$1 and status='running' and attempt_id=$3",[job.id,String(b.error||'Worker failed').slice(0,1000),b.attemptId]);return json({ok:true})
 }
 const {client,Bucket}=videoStorage(),Key=`analysis/${job.id}/${job.attempt_id}/results.tar.gz`
 if(b.action==='upload'){
  if(!Number.isSafeInteger(b.size)||b.size<=0||b.size>5*1024**3)return json({error:'Invalid archive size.'},400)
  return json({url:await getSignedUrl(client,new PutObjectCommand({Bucket,Key,ContentLength:b.size,ContentType:'application/gzip'}),{expiresIn:3600})})
 }
 if(b.action==='complete'){
  const head=await client.send(new HeadObjectCommand({Bucket,Key}));if(!head.ContentLength||head.ContentLength!==b.size)return json({error:'Result upload incomplete.'},409)
  if(!b.metrics||typeof b.metrics!=='object'||Array.isArray(b.metrics)||JSON.stringify(b.metrics).length>50000)return json({error:'Invalid metrics.'},400)
  await db.query("update public.lab_vision_jobs set status='complete',stage='review',result=$2,updated_at=now() where id=$1 and status='running' and attempt_id=$3",[job.id,{archiveKey:Key,metrics:b.metrics,pipeline:'lab-vision-mac-v1',requiresReview:true},b.attemptId]);return json({ok:true})
 }
 return json({error:'Invalid action.'},400)
}
