import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {pgPool} from '@/lib/db'
import {reviewUuid} from '@/lib/scouting/review-notes'
import {videoSource} from '@/lib/scouting/video-review'
export const runtime='nodejs'
const json=(b:unknown,s=200)=>Response.json(b,{status:s,headers:{'Cache-Control':'no-store'}})
type Context={params:Promise<{id:string}>}
async function access(req:Request,ctx:Context,write=false){
 const user=(await auth())?.user
 if(!user?.id||!canViewReports(user))return {error:json({error:'Sign in to review this match.'},401)}
 if(write&&!user.isOperator)return {error:json({error:'An administrator must align the replay.'},403)}
 if(write&&!hasAdminRequestOrigin(req))return {error:json({error:'Invalid origin.'},403)}
 const {id}=await ctx.params,kind=new URL(req.url).searchParams.get('kind')??'canonical'
 if(!reviewUuid.test(id)||!['canonical','manual'].includes(kind))return {error:json({error:'Invalid match.'},400)}
 return {user,id,kind}
}
export async function GET(req:Request,ctx:Context){
 const a=await access(req,ctx);if(a.error)return a.error
 const source=videoSource(new URL(req.url).searchParams.get('url')??'')
 if(!source||source.kind==='file')return json({error:'Invalid replay URL.'},400)
 try{
 const {rows}=await pgPool().query('select recorded_seconds,replay_seconds,updated_at from public.match_replay_alignments where match_id=$1 and match_kind=$2 and video_url=$3',[a.id,a.kind,source.url])
 return json({alignment:rows[0]??null,canEdit:!!a.user.isOperator})
 }catch{return json({error:'Could not load replay alignment.'},503)}
}
export async function POST(req:Request,ctx:Context){
 const a=await access(req,ctx,true);if(a.error)return a.error
 let b:any,source
 try{const text=await req.text();if(text.length>4096)return json({error:'Request too large.'},413);b=JSON.parse(text);source=videoSource(b.videoUrl??'');if(!source||source.kind==='file'||!Number.isFinite(b.recordedSeconds)||b.recordedSeconds<0||b.recordedSeconds>=10000000000||!Number.isFinite(b.replaySeconds)||b.replaySeconds<0||b.replaySeconds>604800)throw Error()}catch{return json({error:'Invalid replay anchor.'},400)}
 try{
 const result=await pgPool().query(`insert into public.match_replay_alignments(match_id,match_kind,video_url,recorded_seconds,replay_seconds,updated_by)
 select id,$2,$3,$4,$5,$6 from public.${a.kind==='manual'?'operator_manual_scouting_matches':'matches'} where id=$1
 on conflict(match_id,match_kind,video_url) do update set recorded_seconds=excluded.recorded_seconds,replay_seconds=excluded.replay_seconds,updated_by=excluded.updated_by,updated_at=now()
 returning recorded_seconds,replay_seconds,updated_at`,[a.id,a.kind,source.url,b.recordedSeconds,b.replaySeconds,a.user.id])
 return result.rowCount?json({alignment:result.rows[0]}):json({error:'Match not found.'},404)
 }catch{return json({error:'Could not save alignment. Please retry.'},503)}
}
