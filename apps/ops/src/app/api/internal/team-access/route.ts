import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function GET(){
 const user=(await auth())?.user;if(!user?.isOperator)return json({error:'Administrator access required.'},user?403:401)
 const db=pgPool()
 const [grants,admins]=await Promise.all([db.query('select email,user_id,role,status,created_at,updated_at from public.scouting_staff_grants order by created_at desc'),db.query('select u.id,u.email from public.operators o join public.users u on u.id=o.user_id')])
 return json({grants:grants.rows,admins:admins.rows})
}
export async function POST(req:Request){
 const user=(await auth())?.user;if(!user?.isOperator)return json({error:'Administrator access required.'},user?403:401)
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Invalid origin.'},403)
 let body;try{body=await req.json()}catch{return json({error:'Invalid request.'},400)}
 if(!body || typeof body!=='object')return json({error:'Invalid request.'},400)
 const email=String(body.email??'').trim().toLowerCase(),status=body.status,role=body.role ?? 'scouter'
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!['active','suspended'].includes(status)||!['viewer','scouter','admin'].includes(role))return json({error:'Enter a valid email, access level and status.'},400)
 const client=await pgPool().connect()
 try{
  await client.query('begin')
  // Serialize access mutations and recheck the actor after acquiring the lock.
  await client.query("select pg_advisory_xact_lock(728491031)")
  const actor=await client.query(`select 1 from public.operators where user_id=$1 union all select 1 from public.scouting_staff_grants where user_id=$1 and role='admin' and status='active'`,[user.id])
  if(!actor.rowCount){await client.query('rollback');return json({error:'Administrator access required.'},403)}

  const admin=await client.query('select 1 from public.operators o join public.users u on u.id=o.user_id where lower(trim(u.email))=$1',[email])
  if(admin.rowCount){await client.query('rollback');return json({error:'Protected administrator accounts cannot be changed here.'},409)}
  const current=await client.query('select role,status,user_id from public.scouting_staff_grants where email=$1 for update',[email])
  const previous=current.rows[0]
  if(previous?.role==='admin' && previous.status==='active' && previous.user_id && (role!=='admin'||status!=='active')){
   const others=await client.query(`select 1 from public.operators where user_id<>$1 union all select 1 from public.scouting_staff_grants where role='admin' and status='active' and user_id is not null and user_id<>$1 limit 1`,[previous.user_id])
   if(!others.rowCount){await client.query('rollback');return json({error:'Keep at least one active administrator before changing this account.'},409)}
  }
  await client.query(`insert into public.scouting_staff_grants(email,status,granted_by,role) values($1,$2,$3,$4)
   on conflict(email) do update set status=excluded.status,role=excluded.role,updated_at=now()`,[email,status,user.id,role])
  // Bind existing verified identities only. Pending grants activate on verified sign-in.
  await client.query(`update public.scouting_staff_grants g set user_id=u.id from public.users u where g.email=$1 and g.user_id is null and lower(trim(u.email))=g.email and u."emailVerified" is not null and (select count(*) from public.users other where lower(trim(other.email))=g.email)=1`,[email])
  await client.query('insert into public.scouting_access_audit(actor_user_id,action,target,details) values($1,$2,$3,$4)',[user.id,status==='active'?'access.granted':'access.suspended',email,JSON.stringify({role,previous:previous??null})])
  await client.query('commit');return json({ok:true,redirect:previous?.user_id===user.id && (role!=='admin'||status!=='active') ? (status==='active'?'/scouting':'/not-authorized') : null})
 }catch{await client.query('rollback');return json({error:'Access could not be updated. Please retry.'},503)}finally{client.release()}
}
