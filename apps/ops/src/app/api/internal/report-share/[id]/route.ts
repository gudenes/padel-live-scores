import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {videoSource} from '@/lib/scouting/video-review'
import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
import {reportContext} from '@/lib/scouting/report-context'
import {savedReport} from '@/lib/scouting/saved-report'
import {reportView} from '@/lib/scouting/report-view'
import {newShortShareToken,validShareToken,shareTokenHash} from '@/lib/scouting/share-token'
export const runtime='nodejs'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
async function authorize(req:Request,id:string){
 const user=(await auth())?.user
 if(!user)return json({error:'Your session has expired. Sign in again to share this report.'},403)
 if(!user.isOperator)return json({error:'Only administrators can create or revoke report links.'},403)
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:'Invalid match.'},400)
 if(!hasAdminRequestOrigin(req))return json({error:'The request came from an unrecognized address. Reopen the report from the admin site and try again.'},403)
 return user
}
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params,user=await authorize(req,id);if(user instanceof Response)return user
 try{
  const body=await req.text()
  if(body.length>8192)return json({error:'Invalid video source.'},400)
  let videoUrl:string|undefined
  if(body){let input;try{input=JSON.parse(body)}catch{return json({error:'Invalid request.'},400)}
   if(input?.videoUrl!=null){if(typeof input.videoUrl!=='string'||!videoSource(input.videoUrl))return json({error:'Unsupported video source.'},400);videoUrl=videoSource(input.videoUrl)!.url}
  }
  const db=pgPool();let source:'video'|'admin'='video'
  let session=(await db.query('select document,players,revision,updated_at from operator_video_scouting_sessions where match_id=$1',[id])).rows[0]
  if(!session){source='admin';session=(await db.query('select document,players,revision,updated_at from operator_scouting_sessions where match_id=$1',[id])).rows[0]}
  if(!session)return json({error:'Save scouting before sharing this report.'},404)
  const snapshot=reportView(savedReport(session,source),await reportContext(id))
  // Preserve the connected source, including an admin's browser-only connection.
  snapshot.videoUrl=videoSource(videoUrl??snapshot.videoUrl??'')?.url??null
  snapshot.players=snapshot.players.map(p=>({id:p.id,name:p.name,shortName:p.shortName,avatar:p.avatar}))
  const token=newShortShareToken()
  const result=await db.query('insert into scouting_report_shares(token_hash,match_id,created_by,snapshot) values($1,$2,$3,$4::jsonb) returning expires_at',[shareTokenHash(token),id,user.id,JSON.stringify(snapshot)])
  return json({path:'/s/'+token,expiresAt:result.rows[0].expires_at})
 }catch{return json({error:'Sharing is unavailable. Please try again after the sharing service is configured.'},503)}
}
export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params,user=await authorize(req,id);if(user instanceof Response)return user
 try{const {token}=await req.json();if(typeof token!=='string'||!validShareToken(token))return json({error:'Invalid link.'},400)
 await pgPool().query('update scouting_report_shares set revoked_at=now() where token_hash=$1 and match_id=$2',[shareTokenHash(token),id]);return json({ok:true})
 }catch{return json({error:'Could not revoke the link.'},503)}
}

export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 const user=(await auth())?.user;if(!user?.isOperator)return json({error:'Not authorized.'},403)
 const {id}=await params;if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:'Invalid match.'},400)
 try{const result=await pgPool().query(`select a.email,a.event,a.created_at from report_share_activity a join scouting_report_shares s on s.token_hash=a.share_hash where s.match_id=$1 order by a.created_at desc limit 100`,[id]);return json({activity:result.rows})}catch{return json({error:'Activity tracking is unavailable.'},503)}
}
