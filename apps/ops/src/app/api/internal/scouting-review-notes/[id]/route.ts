import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {pgPool} from '@/lib/db'
import {parseReviewNote,reviewUuid} from '@/lib/scouting/review-notes'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
type Context={params:Promise<{id:string}>}
async function access(req:Request,ctx:Context,write=false){
 const user=(await auth())?.user
 if(!user?.id||!canViewReports(user))return {error:json({error:'Scouting review access required.'},user?403:401)}
 if(write&&!hasAdminRequestOrigin(req))return {error:json({error:'Invalid origin.'},403)}
 const {id}=await ctx.params,kind=new URL(req.url).searchParams.get('kind')??'canonical'
 if(!reviewUuid.test(id)||!['canonical','manual'].includes(kind))return {error:json({error:'Invalid match.'},400)}
 return {user,id,column:kind==='manual'?'manual_match_id':'canonical_match_id',table:kind==='manual'?'operator_manual_scouting_matches':'matches'}
}
export async function GET(req:Request,ctx:Context){
 const a=await access(req,ctx);if(a.error)return a.error
 try{
  const exists=await pgPool().query(`select id from public.${a.table} where id=$1`,[a.id])
  if(!exists.rowCount)return json({error:'Match not found.'},404)
  const result=await pgPool().query(`select id,author_user_id,author_name,video_url,video_seconds,tag,note,created_at from public.scouting_review_notes where ${a.column}=$1 order by created_at,id`,[a.id])
  return json({notes:result.rows})
 }catch{return json({error:'Review notes are unavailable. Please retry.'},503)}
}
export async function POST(req:Request,ctx:Context){
 const a=await access(req,ctx,true);if(a.error)return a.error
 let note
 try{const text=await req.text();if(text.length>10000)return json({error:'Review note is too large.'},413);note=parseReviewNote(JSON.parse(text))}catch(e){return json({error:e instanceof Error?e.message:'Invalid note.'},400)}
 try{
  const db=pgPool()
  // A client-generated ID makes retries safe after a lost response. No scoring table is writable here.
  const result=await db.query(`insert into public.scouting_review_notes(id,${a.column},author_user_id,author_name,video_url,video_seconds,tag,note)
   select $1,id,$3,$4,$5,$6,$7,$8 from public.${a.table} where id=$2
   on conflict(id) do nothing returning *`,[note.id,a.id,a.user.id,a.user.name?.trim()||'Team member',note.videoUrl,note.seconds,note.tag,note.note])
  if(result.rowCount)return json({note:result.rows[0]},201)
  const prior=await db.query(`select * from public.scouting_review_notes where id=$1 and ${a.column}=$2 and author_user_id=$3`,[note.id,a.id,a.user.id])
  const row=prior.rows[0]
  if(row&&row.video_url===note.videoUrl&&row.video_seconds===note.seconds&&row.tag===note.tag&&row.note===note.note)return json({note:row})
  return json({error:'Match not found or note identifier already used. Refresh and retry.'},409)
 }catch{return json({error:'Could not save the note. Your draft is retained; please retry.'},503)}
}
export async function DELETE(req:Request,ctx:Context){
 const a=await access(req,ctx,true);if(a.error)return a.error
 const noteId=new URL(req.url).searchParams.get('noteId')??''
 if(!reviewUuid.test(noteId))return json({error:'Invalid note.'},400)
 try{
  const result=await pgPool().query(`delete from public.scouting_review_notes where id=$1 and ${a.column}=$2 and author_user_id=$3 returning id`,[noteId,a.id,a.user.id])
  return result.rowCount?json({ok:true}):json({error:'Only your own review notes can be removed.'},403)
 }catch{return json({error:'Could not remove the note. Please retry.'},503)}
}
