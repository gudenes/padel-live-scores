import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function GET(){
 const user=(await auth())?.user;if(!user?.isOperator)return json({error:'Administrator access required.'},user?403:401)
 const db=pgPool()
 const [grants,admins]=await Promise.all([db.query('select email,user_id,status,created_at,updated_at from public.scouting_staff_grants order by created_at desc'),db.query('select u.id,u.email from public.operators o join public.users u on u.id=o.user_id')])
 return json({grants:grants.rows,admins:admins.rows})
}
export async function POST(req:Request){
 const user=(await auth())?.user;if(!user?.isOperator)return json({error:'Administrator access required.'},user?403:401)
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Invalid origin.'},403)
 let body;try{body=await req.json()}catch{return json({error:'Invalid request.'},400)}
 const email=String(body.email??'').trim().toLowerCase(),status=body.status
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!['active','suspended'].includes(status)||body.role&&body.role!=='scouter')return json({error:'Enter a valid email and Scouter access status.'},400)
 const client=await pgPool().connect()
 try{
  await client.query('begin')
  const admin=await client.query('select 1 from public.operators o join public.users u on u.id=o.user_id where lower(trim(u.email))=$1',[email])
  if(admin.rowCount){await client.query('rollback');return json({error:'Administrator accounts cannot be changed here.'},409)}
  await client.query(`insert into public.scouting_staff_grants(email,status,granted_by) values($1,$2,$3)
   on conflict(email) do update set status=excluded.status,updated_at=now()`,[email,status,user.id])
  // Bind existing verified identities only. Pending grants activate on verified sign-in.
  await client.query(`update public.scouting_staff_grants g set user_id=u.id from public.users u where g.email=$1 and g.user_id is null and lower(trim(u.email))=g.email and u."emailVerified" is not null and (select count(*) from public.users other where lower(trim(other.email))=g.email)=1`,[email])
  await client.query('insert into public.scouting_access_audit(actor_user_id,action,target,details) values($1,$2,$3,$4)',[user.id,status==='active'?'access.granted':'access.suspended',email,JSON.stringify({role:'scouter'})])
  await client.query('commit');return json({ok:true})
 }catch{await client.query('rollback');return json({error:'Access could not be updated. Please retry.'},503)}finally{client.release()}
}
