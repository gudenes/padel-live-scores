import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
import {estimateAnalysis} from '@/lib/scouting/analysis-estimate'
import {playbackVideo} from '@/lib/match-video-storage'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {jobBody} from '@/lib/lab-vision-jobs'
import {parseAnnotation} from '@/lib/lab-vision/annotations'
import {createHash,randomUUID} from 'node:crypto'
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import path from 'node:path'
export const runtime='nodejs'
const json=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}})
async function access(){if(process.env.NODE_ENV!=='development')return null;const u=(await auth())?.user;return u?.id&&u.isOperator?u:null}
const folder=(user:string,job:string)=>path.join(process.env.LAB_VISION_ANNOTATIONS_DIR||path.join(process.cwd(),'.local/lab-vision-annotations'),createHash('sha256').update(user).digest('hex'),job)
async function owned(id:string,user:string){if(!/^[0-9a-f-]{36}$/i.test(id))return null;return (await pgPool().query('select j.*,v.file_name,v.duration_seconds,v.object_key,v.byte_size,v.broadcast_offset,v.id as upload_id,v.match_id,v.match_kind from lab_vision_jobs j join match_video_uploads v on v.id=j.video_id where j.id=$1 and j.owner_user_id=$2',[id,user])).rows[0]}
export async function GET(req:Request){const u=await access();if(!u)return json({error:'Local administrator access required.'},403)
 const id=new URL(req.url).searchParams.get('job')
 if(id){const j=await owned(id,u.id!);if(!j)return json({error:'Analysis not found.'},404)
 let annotations:unknown[]=[];try{const dir=folder(u.id!,id);annotations=await Promise.all((await readdir(dir)).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(path.join(dir,f),'utf8'))))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
 return json({video:await playbackVideo({...j,id:j.upload_id}),matchStart:j.setup?.matchStart??0,players:(j.setup?.playerNames??[]).map((name:string,i:number)=>({name,id:j.setup?.playerIds?.[i]??name})),annotations,source:{jobId:j.id,videoId:j.video_id,matchId:j.match_id,pipeline:j.result?.manifest?.pipeline??'Not recorded'}})}
 const {rows}=await pgPool().query('select j.id,j.video_id,j.worker_id,j.status,j.stage,j.progress,j.error,j.updated_at,j.setup,v.match_id,v.file_name from lab_vision_jobs j join match_video_uploads v on v.id=j.video_id where j.owner_user_id=$1 order by j.created_at desc limit 50',[u.id])
 const workers=(await pgPool().query("select id,last_seen_at,last_seen_at>now()-interval '45 seconds' as online from lab_vision_workers where owner_user_id=$1 and revoked_at is null",[u.id])).rows
 return json({jobs:rows.map(j=>({...j,estimate:estimateAnalysis(j)})),workers,checkedAt:new Date().toISOString()})
}
export async function POST(req:Request){const u=await access();if(!u)return json({error:'Local administrator access required.'},403);if(!hasAdminRequestOrigin(req))return json({error:'Invalid origin.'},403)
 try{const b=await jobBody(req,12000);const j=await owned(b.jobId,u.id!);if(!j)return json({error:'Analysis not found.'},404)
 const players=j.setup?.playerNames??[]
 const a=parseAnnotation(b,Number(j.duration_seconds),players)
 if(b.supersedes){if(!/^[0-9a-f-]{36}$/i.test(b.supersedes))throw Error('Invalid original annotation');await readFile(path.join(folder(u.id!,j.id),b.supersedes+'.json'),'utf8')}
 const record={supersedes:b.supersedes||null,schemaVersion:1,id:randomUUID(),...a,playerId:j.setup?.playerIds?.[(j.setup?.playerNames??[]).indexOf(a.player)]??null,jobId:j.id,videoId:j.video_id,matchId:j.match_id,reviewerId:u.id,createdAt:new Date().toISOString(),timebase:'source-video-seconds',origin:'human',trainingEligible:a.status==='verified'&&a.kind==='Shot contact'&&a.shot!=='Unknown'&&!!a.player,trainingStatus:'not_trained'}
 const dir=folder(u.id!,j.id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,record.id+'.json'),JSON.stringify(record,null,2),{flag:'wx',mode:0o600});return json({annotation:record})
 }catch(e){return json({error:e instanceof Error?e.message:'Unable to save annotation'},400)}
}
