// DATABASE_URL required. Argument: previous apps/ops directory. Original files remain intact.
const fs=require('node:fs/promises'),path=require('node:path'),{Pool}=require('pg'),ts=require('typescript'),os=require('node:os');
(async()=>{
 const root=process.argv[2];if(!root)throw Error('Provide previous apps/ops directory');
 const url=new URL(process.env.DATABASE_URL),db=new Pool({host:url.hostname,port:Number(url.port)||5432,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1),ssl:{rejectUnauthorized:false},max:1});
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'lv-import-'));
 for(const name of ['propose-box','contact-candidates'])await fs.writeFile(path.join(tmp,name+'.js'),ts.transpileModule(await fs.readFile('src/lib/lab-vision/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
 const {contactCandidates}=require(path.join(tmp,'contact-candidates.js'));
 let annotations=0,alignments=0,projects=0,caches=0;
 const files=async p=>{try{return await fs.readdir(p,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return [];throw e}};
 const client=await db.connect();
 try{
 await client.query('BEGIN');
 await client.query(await fs.readFile('../../supabase/migrations/20261111100000_lab_vision_annotation_library.sql','utf8'));
 for(const f of await files(path.join(root,'.local/lab-vision-projects'))){if(!f.name.endsWith('.json'))continue;const d=JSON.parse(await fs.readFile(path.join(root,'.local/lab-vision-projects',f.name),'utf8'));await client.query('insert into lab_vision_annotation_projects(match_id,source) values($1,$2) on conflict(match_id) do nothing',[d.matchId,d]);projects++}
 const jobs=new Set();
 for(const user of await files(path.join(root,'.local/lab-vision-annotations')))for(const job of await files(path.join(root,'.local/lab-vision-annotations',user.name))){
  const j=(await client.query('select owner_user_id from lab_vision_jobs where id=$1',[job.name])).rows[0];if(!j)throw Error('Missing analysis '+job.name);
  jobs.add(job.name);
  for(const f of await files(path.join(root,'.local/lab-vision-annotations',user.name,job.name))){if(!f.name.endsWith('.json'))continue;const d=JSON.parse(await fs.readFile(path.join(root,'.local/lab-vision-annotations',user.name,job.name,f.name),'utf8'));
   if(f.name==='shot-alignment.json'){await client.query('insert into lab_vision_annotation_alignments(job_id,payload,updated_by) values($1,$2,$3) on conflict(job_id) do nothing',[job.name,d,j.owner_user_id]);alignments++;continue}
   await client.query('insert into lab_vision_annotations(id,job_id,reviewer_id,supersedes,payload,created_at) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing',[d.id,job.name,d.reviewerId,d.supersedes||null,d,d.createdAt]);annotations++;
  }
 }
 await client.query('COMMIT');
 for(const id of jobs){
  if((await client.query('select 1 from lab_vision_annotation_candidates where job_id=$1',[id])).rowCount)continue;
  const dir=path.join(process.env.LAB_VISION_JOBS_DIR||'/Volumes/Crucial/dev/lab-vision-jobs',id,'viewer');
  const m=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8')),chunks=[];
  for(let i=0;i<m.chunks;i++)chunks.push(JSON.parse(await fs.readFile(path.join(dir,String(i).padStart(3,'0')+'.json'),'utf8')));
  const payload={candidates:contactCandidates(m,chunks),method:'pose-wrist-peaks-v1',limits:'Possible contacts from wrist motion, not a trained contact detector. Serves may be missed; add them manually.'};
  await client.query('insert into lab_vision_annotation_candidates(job_id,payload) values($1,$2) on conflict(job_id) do nothing',[id,payload]);caches++;
 }
 console.log(JSON.stringify({annotations,alignments,projects,caches}));
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release();await db.end();await fs.rm(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e.message);process.exitCode=1});
