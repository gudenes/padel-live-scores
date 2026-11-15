/** Prepare/verify locally, then atomically publish a preserved viewer revision. */
import {loadEnvConfig} from '@next/env';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pgPool} from '../src/lib/db';
import {videoStorage} from '../src/lib/match-video-storage';
import {validateViewerManifest} from '../src/lib/lab-vision-results';
import {parseMovementChunk} from '../src/lib/scouting/movement-artifact';
import {movementSeries,type TrackRow} from '../src/lib/scouting/movement-series';
import {motionSeries} from '../src/lib/scouting/movement-efforts';
import {CopyObjectCommand,PutObjectCommand,HeadObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
async function main(){
 loadEnvConfig(resolve('apps/ops'));
 const [id,directory,mode='--prepare']=process.argv.slice(2);
 if(!/^[a-f0-9-]{36}$/.test(id??'')||!directory||!['--prepare','--verify','--publish'].includes(mode))throw Error('Usage: job-id external-output-directory --prepare|--verify|--publish');
 const dir=resolve(directory);mkdirSync(dir,{recursive:true});
 const read=(name:string)=>JSON.parse(readFileSync(resolve(dir,name),'utf8'));
 const write=(name:string,value:unknown)=>writeFileSync(resolve(dir,name),JSON.stringify(value),{mode:0o600});
 const db=pgPool();try{
 const job=(await db.query("select id,video_id,setup,result,updated_at from lab_vision_jobs where id=$1 and status='complete'",[id])).rows[0];
 if(!job?.result?.viewer)throw Error('Completed viewer required');
 const old=job.result.viewer;
 if(mode==='--prepare'){
  if(existsSync(resolve(dir,'preview.json'))&&read('preview.json').sourcePrefix!==old.prefix)throw Error('Output belongs to another source revision');
  write('preview.json',{jobId:id,sourcePrefix:old.prefix,sourceUpdatedAt:job.updated_at,previewRevision:randomUUID()});write('source-result.json',job.result);write('source-manifest.json',old.manifest);
  const {client,Bucket}=videoStorage();
  for(let i=0;i<old.manifest.chunks;i+=3){await Promise.all(Array.from({length:Math.min(3,old.manifest.chunks-i)},async(_,j)=>{
   const name=String(i+j).padStart(3,'0')+'.json',local='source-'+name;if(existsSync(resolve(dir,local)))return;
   const object=await client.send(new GetObjectCommand({Bucket,Key:old.prefix+name}));const c=JSON.parse(await object.Body!.transformToString());if(!Array.isArray(c.rows))throw Error('Invalid source tracking');write(local,{rows:c.rows});
  }));console.log(`Tracking ${Math.min(i+3,old.manifest.chunks)}/${old.manifest.chunks}`);}
  console.log(execFileSync('python3',[resolve('apps/lab-vision-worker/build_movement_viewer.py'),dir],{encoding:'utf8',maxBuffer:1024*1024}));return;
 }
 const preview=read('preview.json');if(preview.jobId!==id||preview.sourcePrefix!==old.prefix||!isDeepStrictEqual(read('source-result.json'),job.result))throw Error('Source revision changed; prepare a new backfill');
 const manifest=validateViewerManifest(read('manifest.json'),job.setup),keys=manifest.players.map((p:any)=>p.key);
 const data:any=Object.fromEntries(keys.map((k:string)=>[k,[]])),motion:any=Object.fromEntries(keys.map((k:string)=>[k,[]]));
 for(let i=0;i<manifest.chunks;i++){const c=parseMovementChunk(read(`movement-${String(i).padStart(3,'0')}.json`),keys);for(const k of keys){data[k].push(...c.data[k]);motion[k].push(...c.motion[k]);}}
 const digest=createHash('sha256');digest.update(readFileSync(resolve(dir,'manifest.json')));for(let i=0;i<manifest.chunks;i++)digest.update(readFileSync(resolve(dir,`movement-${String(i).padStart(3,'0')}.json`)));const hash=digest.digest('hex');
 if(mode==='--verify'){
  const rows:TrackRow[]=[];for(let i=Math.floor(manifest.start/60);i<manifest.chunks;i++)rows.push(...read(`source-${String(i).padStart(3,'0')}.json`).rows);
  const expected={data:movementSeries(rows,keys),motion:motionSeries(rows,keys)};let values=0,maxError=0;
  function compare(a:any,b:any){if(typeof b==='number'){const error=Math.abs(a-b);if(typeof a!=='number'||!Number.isFinite(a)||error>1e-7)throw Error('Numeric parity mismatch');maxError=Math.max(maxError,error);values++;return;}if(b&&typeof b==='object'){if(!a||JSON.stringify(Object.keys(a).sort())!==JSON.stringify(Object.keys(b).sort()))throw Error('Shape mismatch');for(const k of Object.keys(b))compare(a[k],b[k]);return;}if(a!==b)throw Error('Value mismatch');}
  compare({data,motion},expected);write('verified.json',{previewRevision:preview.previewRevision,hash,values,maxError});console.log(JSON.stringify({verified:true,values,maxError}));return;
 }
 if(read('verified.json').previewRevision!==preview.previewRevision||read('verified.json').hash!==hash)throw Error('Verify this backfill before publishing');
 const {client,Bucket}=videoStorage(),prefix=`analysis/${id}/revisions/${randomUUID()}/viewer/`;
 for(let i=0;i<manifest.chunks;i+=3){await Promise.all(Array.from({length:Math.min(3,manifest.chunks-i)},async(_,j)=>{
  const name=String(i+j).padStart(3,'0')+'.json';
  const source=await client.send(new HeadObjectCommand({Bucket,Key:old.prefix+name}));
  await client.send(new CopyObjectCommand({Bucket,Key:prefix+name,CopySource:`${Bucket}/${old.prefix+name}`}));
  const copied=await client.send(new HeadObjectCommand({Bucket,Key:prefix+name}));if(copied.ContentLength!==source.ContentLength)throw Error('Tracking copy incomplete');
  const body=readFileSync(resolve(dir,'movement-'+name));await client.send(new PutObjectCommand({Bucket,Key:prefix+'movement-'+name,Body:body,ContentType:'application/json'}));
  const check=await client.send(new HeadObjectCommand({Bucket,Key:prefix+'movement-'+name}));if(check.ContentLength!==body.length)throw Error('Movement upload incomplete');
 }));console.log(`Published files ${Math.min(i+3,manifest.chunks)}/${manifest.chunks}`);}
 await client.send(new PutObjectCommand({Bucket,Key:prefix+'manifest.json',Body:JSON.stringify(manifest),ContentType:'application/json'}));
 const stored=await client.send(new GetObjectCommand({Bucket,Key:prefix+'manifest.json'}));validateViewerManifest(JSON.parse(await stored.Body!.transformToString()),job.setup);
 const updated=await db.query("update lab_vision_jobs set result=$2,updated_at=now() where id=$1 and status='complete' and result=$3::jsonb returning id",[id,JSON.stringify({...job.result,viewer:{prefix,manifest}}),JSON.stringify(job.result)]);
 if(updated.rowCount!==1)throw Error('Concurrent change; original revision remains intact');write('published.json',{id,prefix});console.log('Movement revision published; original artifacts preserved.');
 }finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
