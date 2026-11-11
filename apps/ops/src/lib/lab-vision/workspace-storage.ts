import {GetObjectCommand} from '@aws-sdk/client-s3'
import {pgPool} from '@/lib/db'
import {videoStorage} from '@/lib/match-video-storage'
import {contactCandidates} from './contact-candidates'
export async function annotationProject(matchId:string){
 const row=(await pgPool().query('select source from lab_vision_annotation_projects where match_id=$1',[matchId])).rows[0]
 if(!row)throw Error('Scouting project not imported')
 return row.source
}
const pending=new Map<string,Promise<any>>()
export async function serveCandidates(job:any){
 const saved=(await pgPool().query('select payload from lab_vision_annotation_candidates where job_id=$1',[job.id])).rows[0]
 if(saved)return saved.payload
 if(pending.has(job.id))return pending.get(job.id)
 const task=(async()=>{
  const v=job.result?.viewer,m=v?.manifest
  if(job.status!=='complete'||!v?.prefix||!m||!Number.isInteger(m.chunks)||m.chunks<1||m.chunks>2000)throw Error('Tracking unavailable')
  const {client,Bucket}=videoStorage(),candidates:any[]=[]
  let previous:any=null
  for(let i=0;i<m.chunks;i++){
   const object=await client.send(new GetObjectCommand({Bucket,Key:v.prefix+String(i).padStart(3,'0')+'.json'}))
   const chunk=JSON.parse(await object.Body!.transformToString())
   candidates.push(...contactCandidates(m,previous?[previous,chunk]:[chunk]));previous=chunk
  }
  const unique=[...new Map(candidates.map(c=>[c.id,c])).values()].sort((a,b)=>a.time-b.time)
  const payload={candidates:unique,method:'pose-wrist-peaks-v1',limits:'Possible contacts from wrist motion, not a trained contact detector. Review before use; add missed serves manually.'}
  await pgPool().query('insert into lab_vision_annotation_candidates(job_id,payload) values($1,$2) on conflict(job_id) do nothing',[job.id,payload])
  return payload
 })()
 pending.set(job.id,task)
 try{return await task}finally{pending.delete(job.id)}
}
