import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {jobBody} from '@/lib/lab-vision-jobs'
import {datasetSummary,validateSplit,evaluatePredictions} from '@/lib/lab-vision/training'
import {randomUUID,createHash} from 'node:crypto'
export const runtime='nodejs'
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
async function access(){const u=(await auth())?.user;return u?.isOperator?u.id:null}
async function annotations(){const {rows}=await pgPool().query(`select a.payload,v.file_name,v.duration_seconds,v.match_id,j.id as source_job_id,j.video_id from lab_vision_annotations a join lab_vision_jobs j on j.id=a.job_id join match_video_uploads v on v.id=j.video_id order by a.created_at,a.id`);return rows.map(r=>({...r.payload,jobId:r.source_job_id,videoId:r.video_id,matchId:r.match_id,fileName:r.file_name,duration:Number(r.duration_seconds)}))}
async function files(){const {rows}=await pgPool().query('select payload from lab_vision_training_artifacts order by created_at,id');return rows.map(r=>r.payload)}
async function save(data:any){await pgPool().query('insert into lab_vision_training_artifacts(id,kind,created_by,payload,created_at) values($1,$2,$3,$4,$5)',[data.id,data.kind,data.createdBy,data,data.createdAt]);return data}
export async function GET(){if(!await access())return json({error:'Administrator access required.'},403);
 try{return json({annotations:datasetSummary(await annotations()).latest,artifacts:(await files()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)),checkedAt:new Date().toISOString(),runnerConnected:false})}catch{return json({error:'Could not load annotations or saved training artifacts. Retry.'},500)}}
export async function POST(req:Request){if(!await access()||!hasAdminRequestOrigin(req))return json({error:'Administrator access and same origin required.'},403);
 try{const b=await jobBody(req,2000000),base={id:randomUUID(),createdAt:new Date().toISOString(),createdBy:await access(),schemaVersion:1,eligibilityPolicy:'verified-contact-box-starter-eight-v3',timebase:'source-video-seconds'}
 if(b.action==='snapshot'){
  if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw Error('Give the snapshot a name (up to 80 characters).')
  const all=datasetSummary(await annotations()).ready
  const samples=all.filter(a=>Object.hasOwn(b.split??{},a.matchId));if(!samples.length)throw Error('No eligible clips in the selected matches.')
  const check=validateSplit(samples,b.split);const split=Object.fromEntries(check.matches.map(m=>[m,b.split[m]]))
  return json(await save({...base,kind:'snapshot',name:b.name.trim(),samples,split,canTrain:check.canTrain,sha256:createHash('sha256').update(JSON.stringify({samples,split})).digest('hex'),purpose:'shot-classification-at-verified-contacts',classMapping:'starter-eight-v3'}))
 }
 const all=await files(),snapshot=all.find(a=>a.id===b.snapshotId&&a.kind==='snapshot');if(!snapshot)throw Error('Choose a saved dataset snapshot.')
 if(b.action==='plan'){
  if(!snapshot.canTrain)throw Error('Assign separate training, validation and test matches first.')
  if(!Number.isInteger(b.epochs)||b.epochs<1||b.epochs>200||!Number.isFinite(b.budget)||b.budget<=0||b.budget>100)throw Error('Choose 1–200 epochs and a budget between €0 and €100.')
  return json(await save({...base,kind:'plan',snapshotId:snapshot.id,name:typeof b.name==='string'?b.name.slice(0,80):'Shot classifier',status:'prepared',epochs:b.epochs,budgetEUR:b.budget,inputs:'video-clips-and-pose',ballModel:'WASB unchanged',runnerConnected:false}))
 }
 if(b.action==='evaluation'){
  if(typeof b.modelVersion!=='string'||!b.modelVersion.trim()||b.modelVersion.length>80)throw Error('Provide the model version.')
  const evaluation=evaluatePredictions(snapshot,b.predictions)
  return json(await save({...base,kind:'evaluation',snapshotId:snapshot.id,modelVersion:b.modelVersion.trim(),...evaluation,provenance:'Imported predictions; metrics calculated against saved human labels',releaseStatus:'candidate'}))
 }
 throw Error('Unknown training action.')
 }catch(e){return json({error:e instanceof Error?e.message:'Unable to save training artifact.'},400)}}
