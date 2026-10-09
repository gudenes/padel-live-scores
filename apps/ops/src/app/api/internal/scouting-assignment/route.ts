import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
export async function POST(req:Request){
 const user=(await auth())?.user
 if(!user?.isOperator)return Response.json({error:'Administrator access required.'},{status:user?403:401})
 if(req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Invalid origin.'},{status:403})
 let body;try{body=await req.json()}catch{return Response.json({error:'Invalid request.'},{status:400})}
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.matchId??'')||!['match','private'].includes(body.kind)||typeof body.email!=='string')return Response.json({error:'Invalid assignment.'},{status:400})
 const table=body.kind==='private'?'operator_manual_video_scouting_sessions':'operator_video_scouting_sessions'
 const db=await pgPool().connect()
 try{
  await db.query('begin')
  const target=await db.query("select user_id from public.scouting_staff_grants where email=$1 and status='active' and user_id is not null for share",[body.email.trim().toLowerCase()])
  if(!target.rowCount){await db.query('rollback');return Response.json({error:'Choose an active scouter who has signed in.'},{status:400})}
  const result=await db.query(`update public.${table} set assigned_scouter_user_id=$1,updated_by_user_id=$2,revision=revision+1,write_id=gen_random_uuid(),updated_at=now() where match_id=$3 returning match_id`,[target.rows[0].user_id,user.id,body.matchId])
  if(!result.rowCount){await db.query('rollback');return Response.json({error:'No extension session exists for this match yet.'},{status:404})}
  await db.query('commit');return Response.json({ok:true})
 }catch{await db.query('rollback');return Response.json({error:'Could not assign this session.'},{status:503})}finally{db.release()}
}
