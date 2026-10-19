import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {randomUUID} from 'node:crypto'
import {NextResponse} from 'next/server'
import {pgPool} from '@/lib/db'
import {getClientIp} from '@/lib/client-ip'
import {newShareToken,shareTokenHash,validShareToken} from '@/lib/scouting/share-token'
import {normalizeShareEmail,newShareCode,codeDigest,matchesCode,shareDigest,visitorCookie} from '@/lib/scouting/share-verification'
import {sendReportCode} from '@/lib/email/report-code'
export const runtime='nodejs'
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function POST(req:Request,{params}:{params:Promise<{token:string}>}){
 const {token}=await params
 if(!validShareToken(token))return json({error:'This link is unavailable.'},404)
 if(!hasAdminRequestOrigin(req))return json({error:'Invalid origin.'},403)
 let body;try{const text=await req.text();if(text.length>2048)return json({error:'Invalid request.'},400);body=JSON.parse(text)}catch{return json({error:'Invalid request.'},400)}
 const share=shareTokenHash(token),db=pgPool(),client=await db.connect()
 let transaction=false
 try{
  await client.query('begin');transaction=true
  const active=await client.query('select token_hash from scouting_report_shares where token_hash=$1 and revoked_at is null and expires_at>now() for update',[share])
  if(!active.rows.length){await client.query('rollback');transaction=false;return json({error:'This link is unavailable.'},404)}
  const ip=shareDigest('report-ip:'+(getClientIp(req.headers)??'unknown'))
  const activity=async(event:string,email:string|null)=>client.query('insert into report_share_activity(share_hash,email,event,ip_hash) values($1,$2,$3,$4)',[share,email,event,ip])
  if(body.action==='request'){
   const email=normalizeShareEmail(body.email);if(!email){await client.query('rollback');transaction=false;return json({error:'Enter a valid email address.'},400)}
   // Serialize requests across links for the same IP, as well as this link's row lock.
   await client.query('select pg_advisory_xact_lock(hashtext($1))',[ip])
   const limits=await client.query(`select count(*) filter(where share_hash=$1 and email=$2) as recipient,count(*) filter(where ip_hash=$3) as ip,count(*) filter(where share_hash=$1) as link,count(*) filter(where share_hash=$1 and email=$2 and created_at>now()-interval '60 seconds') as recent from report_share_activity where event='code_requested' and created_at>now()-interval '1 hour'`,[share,email,ip])
   const limit=limits.rows[0]
   if(Number(limit.recipient)>=5||Number(limit.ip)>=20||Number(limit.link)>=100||Number(limit.recent)>0){await client.query('rollback');transaction=false;return json({error:'Please wait before requesting another code.'},429)}
   const id=randomUUID(),code=newShareCode()
   await activity('code_requested',email)
   await client.query('insert into report_share_codes(id,share_hash,email,code_hash,expires_at) values($1,$2,$3,$4,now()+interval \'10 minutes\')',[id,share,email,codeDigest(id,code)])
   await client.query('commit');transaction=false
   try{await sendReportCode(email,code);await db.query('insert into report_share_activity(share_hash,email,event) values($1,$2,\'code_sent\')',[share,email]);return json({challengeId:id})}
   catch(error){console.error('report.code_request_failed',{name:error instanceof Error?error.name:'unknown',code:typeof error==='object'&&error&&'code' in error?error.code:undefined});await db.query('update report_share_codes set consumed_at=now() where id=$1',[id]);await db.query('insert into report_share_activity(share_hash,email,event) values($1,$2,\'delivery_failed\')',[share,email]);return json({error:'We could not send the code. Please try again later.'},503)}
  }
  if(body.action==='verify'&&typeof body.challengeId==='string'&&/^[0-9a-f-]{36}$/i.test(body.challengeId)&&typeof body.code==='string'){
   const result=await client.query('select * from report_share_codes where id=$1 and share_hash=$2 and consumed_at is null and expires_at>now() and attempts<5 for update',[body.challengeId,share]),challenge=result.rows[0]
   if(!challenge){await client.query('rollback');transaction=false;return json({error:'Code expired or unavailable. Request a new code.'},400)}
   await client.query('update report_share_codes set attempts=attempts+1 where id=$1',[challenge.id])
   if(!matchesCode(challenge.id,body.code,challenge.code_hash)){await activity('verification_failed',challenge.email);await client.query('commit');transaction=false;return json({error:'Incorrect code. Please try again.'},400)}
   await client.query('update report_share_codes set consumed_at=now() where share_hash=$1 and email=$2 and consumed_at is null',[share,challenge.email])
   const session=newShareToken()
   await client.query('insert into report_share_visitors(session_hash,share_hash,email,expires_at) values($1,$2,$3,now()+interval \'24 hours\')',[shareTokenHash(session),share,challenge.email])
   await activity('verified',challenge.email);await client.query('commit');transaction=false
   const response=json({ok:true});response.cookies.set(visitorCookie(share),session,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:token.length===22?'/s/'+token:'/shared/report/'+token,maxAge:86400});return response
  }
  await client.query('rollback');transaction=false;return json({error:'Invalid request.'},400)
 }catch{if(transaction)await client.query('rollback');return json({error:'Verification is unavailable. Please try again later.'},503)}finally{client.release()}
}
