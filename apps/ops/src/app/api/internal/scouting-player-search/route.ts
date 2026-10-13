import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {pgPool} from '@/lib/db'
export async function GET(req:Request){
 if(!canViewReports((await auth())?.user))return Response.json({error:'Sign in with scouting access.'},{status:401})
 const q=(new URL(req.url).searchParams.get('q')??'').trim().slice(0,100)
 if(q.length<3)return Response.json({players:[]})
 try{
  const {rows}=await pgPool().query('select id,name,country,ranking from public.players where name ilike $1 order by ranking asc nulls last,name,id limit 12',['%'+q.replace(/[\\%_]/g,'\\$&')+'%'])
  return Response.json({players:rows},{headers:{'Cache-Control':'private, no-store'}})
 }catch{return Response.json({error:'Could not search players. Please retry.'},{status:503})}
}
