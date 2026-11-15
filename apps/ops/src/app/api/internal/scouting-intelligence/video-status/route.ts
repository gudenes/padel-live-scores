import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {pgPool} from '@/lib/db'
import {parseVideoStatusMatches,stagePercent,type VideoStatusDetail} from '@/lib/scouting/intelligence/video-status'
export const dynamic='force-dynamic'
export async function GET(request:Request){
 const user=(await auth())?.user
 if(!user?.id||!canViewReports(user))return Response.json({error:'Sign in with scouting access.'},{status:401})
 let matches;try{matches=parseVideoStatusMatches(new URL(request.url).searchParams.get('matches')??'')}catch{return Response.json({error:'Invalid match selection.'},{status:400})}
 try{
 const db=pgPool()
 // Rank the owner's complete waiting queue, not just matches visible on this page.
 const jobs=(await db.query(`select j.id,j.status,j.stage,j.progress,j.owner_user_id,
 v.match_id,v.match_kind,v.file_name,j.setup->'playerNames' as names,
 exists(select 1 from lab_vision_workers w where w.owner_user_id=j.owner_user_id and w.revoked_at is null and w.last_seen_at>now()-interval '45 seconds') as online
 from lab_vision_jobs j join match_video_uploads v on v.id=j.video_id
 where j.owner_user_id=$1 and j.status in ('queued','running') order by j.created_at,j.id`,[user.id])).rows
 let waiting=0
 const queue=jobs.map(j=>({id:j.id,matchId:j.match_id,kind:j.match_kind,name:Array.isArray(j.names)?j.names.join(' / '):j.file_name,state:j.status==='queued'?'queued':'processing',position:j.status==='queued'?++waiting:undefined,percent:stagePercent(j.progress),stage:j.stage,online:j.online}))
 const rows=matches.length?(await db.query(`with videos as (
 select distinct on (v.match_kind,v.match_id) v.id,v.match_kind,v.match_id
 from match_video_uploads v join jsonb_to_recordset($1::jsonb) as requested(id uuid,kind text)
 on v.match_id=requested.id and v.match_kind=requested.kind
 where v.status='ready' order by v.match_kind,v.match_id,v.completed_at desc,v.id
 ) select v.match_kind||':'||v.match_id::text as key,
 exists(select 1 from lab_vision_jobs j where j.video_id=v.id and j.status='complete' and j.result->'viewer'->>'prefix' is not null and jsonb_typeof(j.result->'viewer'->'manifest')='object') as ready,
 active.id,active.status,active.stage,active.progress,active.owner_user_id
 from videos v left join lateral (select id,status,stage,progress,owner_user_id from lab_vision_jobs where video_id=v.id and status in ('queued','running') order by created_at,id limit 1) active on true`,[JSON.stringify(matches)])).rows:[]
 const statuses:Record<string,VideoStatusDetail>={}
 for(const row of rows){
  if(row.ready)statuses[row.key]={state:'ready'}
  else if(row.status){const own=queue.find(j=>j.id===row.id);statuses[row.key]={state:row.status==='queued'?'queued':'processing',stage:row.stage,percent:stagePercent(row.progress),position:own?.position,owned:row.owner_user_id===user.id&&!!user.isOperator}}
 }
 return Response.json({statuses,queue,canCancel:!!user.isOperator},{headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({error:'Video status unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
