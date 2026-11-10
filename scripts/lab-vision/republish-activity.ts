/** Operator-only backfill: preserve original artifacts, publish a new viewer revision atomically. */
import {loadEnvConfig} from '@next/env';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pgPool} from '../../apps/ops/src/lib/db';
import {videoStorage} from '../../apps/ops/src/lib/match-video-storage';
import {validateViewerManifest} from '../../apps/ops/src/lib/lab-vision-results';
import {CopyObjectCommand,PutObjectCommand,HeadObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
async function main(){
 loadEnvConfig(resolve('apps/ops'));
 const [id,file,mode]=process.argv.slice(2);if(!/^[a-f0-9-]{36}$/.test(id??''))throw Error('Provide job id and activity JSON; optional --publish');
 const db=pgPool();try{
 const job=(await db.query('select * from public.lab_vision_jobs where id=$1',[id])).rows[0];
 if(!job||job.status!=='complete'||!job.result?.viewer)throw Error('Requires a completed job with published viewer');
 const running=(await db.query("select id from public.lab_vision_jobs where status='running' and lease_until>now() and worker_id=$1",[job.worker_id])).rows;
 if(running.length)throw Error('Worker is busy; do not update installation yet');
 if(!file){console.log(JSON.stringify({job:id,status:job.status,workerIdle:true,hasActivity:!!job.result.viewer.manifest.activity}));return}
 const input=JSON.parse(readFileSync(file,'utf8'));
 const patch=input.scoutingAlignment?{scoutingAlignment:input.scoutingAlignment}:{activity:input};
 const manifest=validateViewerManifest({...job.result.viewer.manifest,...patch},job.setup);
 console.log(JSON.stringify({job:id,windows:manifest.activity?.windows.length,retainedSeconds:manifest.activity?.duration,scoutingAlignment:manifest.scoutingAlignment,videoSeconds:manifest.duration,mode:mode??'validate'}));
 if(mode!=='--publish')return;
 const dir=resolve('/Volumes/Crucial/dev/lab-vision-jobs',id,'publication-backups');mkdirSync(dir,{recursive:true});
 writeFileSync(resolve(dir,`${Date.now()}-result.json`),JSON.stringify(job.result),{mode:0o600});
 const {client,Bucket}=videoStorage();const prefix=`analysis/${id}/revisions/${randomUUID()}/viewer/`;
 for(let i=0;i<manifest.chunks;i++){
  const name=`${String(i).padStart(3,'0')}.json`;
  const original=await client.send(new HeadObjectCommand({Bucket,Key:job.result.viewer.prefix+name}));
  await client.send(new CopyObjectCommand({Bucket,Key:prefix+name,CopySource:`${Bucket}/${job.result.viewer.prefix+name}`}));
  const copied=await client.send(new HeadObjectCommand({Bucket,Key:prefix+name}));
  if(copied.ContentLength!==original.ContentLength)throw Error('Viewer copy incomplete');
 }
 await client.send(new PutObjectCommand({Bucket,Key:prefix+'manifest.json',Body:JSON.stringify(manifest),ContentType:'application/json'}));
 const stored=await client.send(new GetObjectCommand({Bucket,Key:prefix+'manifest.json'}));validateViewerManifest(JSON.parse(await stored.Body!.transformToString()),job.setup);
 const result={...job.result,viewer:{prefix,manifest}};
 const updated=await db.query("update public.lab_vision_jobs set result=$2,updated_at=now() where id=$1 and status='complete' and result=$3::jsonb returning id",[id,JSON.stringify(result),JSON.stringify(job.result)]);
 if(updated.rowCount!==1)throw Error('Concurrent result change; original publication preserved');
 console.log('Published viewer metadata revision; original video, model outputs and archive preserved.');
 }finally{await db.end()}
}
main().catch(()=>{console.error('Activity publication failed; inspect inputs/connectivity. Existing result stays unchanged until final update.');process.exitCode=1});
