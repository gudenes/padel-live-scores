import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {pgPool} from '@/lib/db'
import {check} from '@/lib/rate-limit'
import {videoStorage,videoStorageReady,playbackVideo} from '@/lib/match-video-storage'
import {videoUuid,parseVideoUpload,VIDEO_PART_SIZE,expectedPartSize,validateParts} from '@/lib/scouting/match-video'
import {CreateMultipartUploadCommand,UploadPartCommand,ListPartsCommand,CompleteMultipartUploadCommand,AbortMultipartUploadCommand,HeadObjectCommand} from '@aws-sdk/client-s3'
import {getSignedUrl} from '@aws-sdk/s3-request-presigner'
export const runtime='nodejs'
const json=(b:unknown,s=200)=>Response.json(b,{status:s,headers:{'Cache-Control':'no-store'}})
type Context={params:Promise<{id:string}>}
async function access(req:Request,ctx:Context,write=false){
 const user=(await auth())?.user
 if(!user?.id||!canViewReports(user))return {error:json({error:'Sign in to review this match.'},401)}
 // Uploads are operator-only in this first release; viewers never receive upload URLs.
 if(write&&!user.isOperator)return {error:json({error:'An administrator must upload match videos.'},403)}
 if(write&&!hasAdminRequestOrigin(req))return {error:json({error:'Invalid origin.'},403)}
 const {id}=await ctx.params,kind=new URL(req.url).searchParams.get('kind')??'canonical'
 if(!videoUuid.test(id)||!['canonical','manual'].includes(kind))return {error:json({error:'Invalid match.'},400)}
 return {user,id,kind}
}
export async function GET(req:Request,ctx:Context){
 const a=await access(req,ctx);if(a.error)return a.error
 if(!videoStorageReady())return json({configured:false,canUpload:false,video:null})
 try{
  const {rows}=await pgPool().query("select * from public.match_video_uploads where match_id=$1 and match_kind=$2 and status='ready' order by completed_at desc limit 1",[a.id,a.kind])
  return json({configured:true,canUpload:!!a.user.isOperator,video:rows[0]?await playbackVideo(rows[0]):null})
 }catch{return json({error:'Hosted video is unavailable. Please retry.'},503)}
}
export async function POST(req:Request,ctx:Context){
 const a=await access(req,ctx,true);if(a.error)return a.error
 if(!check(`match-video:${a.user.id}`,120,60_000).allowed)return json({error:'Please wait before retrying.'},429)
 if(!videoStorageReady())return json({error:'Cloudflare video storage is not connected yet. Your local video is unchanged.'},503)
 let b:any
 try{if(!req.headers.get('content-type')?.startsWith('application/json'))throw Error();const reader=req.body?.getReader();if(!reader)throw Error();let text='',size=0;const decoder=new TextDecoder();for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>16000){await reader.cancel();return json({error:'Request too large.'},413)}text+=decoder.decode(r.value,{stream:true})}b=JSON.parse(text+decoder.decode());if(!videoUuid.test(b.id??''))throw Error()}catch{return json({error:'Invalid upload request.'},400)}
 const db=pgPool(),{client,Bucket}=videoStorage()
 try{
  if(b.action==='start'){
   let v;try{v=parseVideoUpload(b)}catch(e){return json({error:(e as Error).message},400)}
   if(!check(`match-video-start:${a.user.id}`,10,3600_000).allowed)return json({error:'Upload limit reached. Resume an existing upload or try later.'},429)
   const exists=await db.query(`select id from public.${a.kind==='manual'?'operator_manual_scouting_matches':'matches'} where id=$1`,[a.id]);if(!exists.rowCount)return json({error:'Match not found.'},404)
   const key=`matches/${a.kind}/${a.id}/${v.id}.${v.type==='video/webm'?'webm':'mp4'}`
   await db.query(`insert into public.match_video_uploads(id,match_id,match_kind,owner_user_id,file_name,byte_size,duration_seconds,broadcast_offset,object_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(id) do nothing`,[v.id,a.id,a.kind,a.user.id,v.name,v.size,v.duration,v.offset,key])
  }
  const result=await db.query('select * from public.match_video_uploads where id=$1 and match_id=$2 and match_kind=$3 and owner_user_id=$4',[b.id,a.id,a.kind,a.user.id]);let row=result.rows[0]
  if(!row)return json({error:'Upload not found.'},404)
  if(b.action==='start'&&(row.file_name!==b.name||Number(row.byte_size)!==b.size||row.broadcast_offset!==b.offset))return json({error:'Upload refers to a different file or timing. Start a new upload.'},409)
  if(row.status==='ready')return json({video:await playbackVideo(row),ready:true})
  if(row.status==='cancelled')return json({error:'Upload was cancelled. Start a new upload.'},409)
  if(b.action==='start'&&!row.multipart_id){
   const created=await client.send(new CreateMultipartUploadCommand({Bucket,Key:row.object_key,ContentType:/\.webm$/i.test(row.file_name)?'video/webm':'video/mp4',CacheControl:'private, max-age=3600'}))
   const saved=await db.query('update public.match_video_uploads set multipart_id=$2 where id=$1 and multipart_id is null returning *',[row.id,created.UploadId]);
   if(saved.rows[0])row=saved.rows[0];else{await client.send(new AbortMultipartUploadCommand({Bucket,Key:row.object_key,UploadId:created.UploadId}));row=(await db.query('select * from public.match_video_uploads where id=$1',[row.id])).rows[0]}
  }
  const params={Bucket,Key:row.object_key,UploadId:row.multipart_id}
  if(b.action==='cancel'){
   if(row.multipart_id)await client.send(new AbortMultipartUploadCommand(params))
   await db.query("update public.match_video_uploads set status='cancelled' where id=$1 and status='uploading'",[row.id]);return json({cancelled:true})
  }
  if(!row.multipart_id)return json({error:'Start the upload first.'},409)
  if(b.action==='part'){
   let length;try{length=expectedPartSize(Number(row.byte_size),b.part)}catch{return json({error:'Invalid part.'},400)}
   return json({url:await getSignedUrl(client,new UploadPartCommand({...params,PartNumber:b.part,ContentLength:length}),{expiresIn:3600})})
  }
  // A failed response after R2 completed must be safe to retry.
  if(b.action==='complete'){
   let complete=false
   try{const head=await client.send(new HeadObjectCommand({Bucket,Key:row.object_key}));complete=head.ContentLength===Number(row.byte_size)}catch{}
   if(!complete){
    const list=await client.send(new ListPartsCommand(params));let parts;try{parts=validateParts(Number(row.byte_size),list.Parts??[])}catch(e){return json({error:(e as Error).message},409)}
    await client.send(new CompleteMultipartUploadCommand({...params,MultipartUpload:{Parts:parts}}))
    const head=await client.send(new HeadObjectCommand({Bucket,Key:row.object_key}));if(head.ContentLength!==Number(row.byte_size))throw Error('size mismatch')
   }
   row=(await db.query("update public.match_video_uploads set status='ready',completed_at=coalesce(completed_at,now()) where id=$1 returning *",[row.id])).rows[0]
   return json({video:await playbackVideo(row),ready:true})
  }
  if(b.action==='start'||b.action==='resume'){
   const list=await client.send(new ListPartsCommand(params));return json({id:row.id,partSize:VIDEO_PART_SIZE,parts:(list.Parts??[]).map(p=>({number:p.PartNumber,size:p.Size}))})
  }
  return json({error:'Unknown upload action.'},400)
 }catch{return json({error:'Storage could not complete this step. Your upload can be resumed; please retry.'},503)}
}
