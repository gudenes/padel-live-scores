import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {auth} from '@/lib/auth'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {pgPool} from '@/lib/db'
import {check} from '@/lib/rate-limit'
import {videoUuid} from '@/lib/scouting/match-video'
import {jobBody,validateJobSetup,jobJson as json} from '@/lib/lab-vision-jobs'
import {videoStorage} from '@/lib/match-video-storage'
import {GetObjectCommand} from '@aws-sdk/client-s3'
import {getSignedUrl} from '@aws-sdk/s3-request-presigner'
export const runtime='nodejs'
export async function GET(req:Request){
 const user=(await auth())?.user;if(!user?.id||!user.isOperator)return json({error:'Administrator access required.'},403)
 const id=new URL(req.url).searchParams.get('video');if(!videoUuid.test(id??''))return json({error:'Invalid video.'},400)
 const db=pgPool();const jobs=await db.query('select j.id,j.status,j.stage,j.progress,j.error,j.result,j.setup,j.updated_at from public.lab_vision_jobs j join public.match_video_uploads v on v.id=j.video_id where j.video_id=$1 and j.owner_user_id=$2 order by j.created_at desc limit 1',[id,user.id]);
 const workers=await db.query("select id,name,last_seen_at,last_seen_at>now()-interval '45 seconds' as online from public.lab_vision_workers where owner_user_id=$1 and revoked_at is null order by created_at desc",[user.id]);
 const job=jobs.rows[0]??null;if(job?.status==='complete'&&job.result?.archiveKey){const {client,Bucket}=videoStorage();job.download=await getSignedUrl(client,new GetObjectCommand({Bucket,Key:job.result.archiveKey}),{expiresIn:3600})}
 return json({job,workers:workers.rows})
}
export async function POST(req:Request){
 const user=(await auth())?.user;if(!user?.id||!user.isOperator)return json({error:'Administrator access required.'},403)
 if(!hasAdminRequestOrigin(req))return json({error:'Invalid origin.'},403)
 if(!check(`vision-jobs:${user.id}`,30,60000).allowed)return json({error:'Please wait before retrying.'},429)
 let b;try{b=await jobBody(req)}catch(e){return json({error:(e as Error).message},400)}const db=pgPool()
 if(b.action==='connect'){
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  await db.query('insert into public.lab_vision_workers(id,owner_user_id,token_hash) values($1,$2,$3)',[id,user.id,createHash('sha256').update(token).digest('hex')]);
  return json({config:{server:new URL(req.url).origin,workerId:id,token},message:'Keep this file private. It authorizes only your analysis jobs.'})
 }
 if(b.action==='disconnect'&&videoUuid.test(b.workerId??'')){await db.query('update public.lab_vision_workers set revoked_at=now() where id=$1 and owner_user_id=$2',[b.workerId,user.id]);return json({ok:true})}
 if(b.action==='cancel'&&videoUuid.test(b.id??'')){await db.query("update public.lab_vision_jobs set status='cancelled',updated_at=now() where id=$1 and owner_user_id=$2 and status in ('queued','running')",[b.id,user.id]);return json({ok:true})}
 if(b.action!=='run'||!videoUuid.test(b.videoId??''))return json({error:'Invalid action.'},400)
 const {rows}=await db.query("select * from public.match_video_uploads where id=$1 and owner_user_id=$2 and status='ready'",[b.videoId,user.id]);const video=rows[0];if(!video)return json({error:'Upload the video before starting analysis.'},404)
 let setup;try{setup=validateJobSetup(b.setup,video)}catch(e){return json({error:(e as Error).message},400)}
 if(!['sample','full'].includes(b.scope))return json({error:'Select a sample or full analysis.'},400)
 const id=randomUUID();const result=await db.query("insert into public.lab_vision_jobs(id,video_id,owner_user_id,setup) values($1,$2,$3,$4) on conflict(video_id) where status in ('queued','running') do nothing returning id",[id,video.id,user.id,JSON.stringify({...setup,analysisSeconds:b.scope==='sample'?Math.min(60,setup.duration-setup.matchStart):setup.duration-setup.matchStart})]);
 return json({id:result.rows[0]?.id??(await db.query("select id from public.lab_vision_jobs where video_id=$1 and status in ('queued','running')",[video.id])).rows[0]?.id})
}
