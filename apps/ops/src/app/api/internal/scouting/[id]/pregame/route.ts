import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {intelligenceData} from '@/lib/scouting/intelligence/data'
import {buildPregame} from '@/lib/scouting/intelligence/pregame'
export const dynamic='force-dynamic'
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!canViewReports((await auth())?.user))return Response.json({error:'Sign in with scouting access.'},{status:401})
 const {id}=await params,year=new URL(request.url).searchParams.get('year')??undefined
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)||year&&!/^\d{4}$/.test(year))return Response.json({error:'Invalid match or year.'},{status:400})
 try {
  const source=await intelligenceData(),target=source.history.find(m=>m.id===id&&!m.manual)
  if(!target)return Response.json({error:'Official match not found.'},{status:404})
  if(!target.date||target.playerIds.some(id=>!id)||new Set(target.playerIds).size!==4)return Response.json({error:'Pre-game comparison needs four identified players and a scheduled date.'},{status:422})
  return Response.json(buildPregame(source,target,year),{headers:{'Cache-Control':'no-store'}})
 }catch(e){console.error('Pre-game comparison failed',e instanceof Error?e.message:e);return Response.json({error:'Pre-game comparison could not be loaded. Please retry.'},{status:503})}
}
