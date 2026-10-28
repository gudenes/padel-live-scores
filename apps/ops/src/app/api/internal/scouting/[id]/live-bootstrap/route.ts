import {auth} from '@/lib/auth'
import {canScout} from '@/lib/scouting-permissions'
import {reportContext} from '@/lib/scouting/report-context'
export const dynamic='force-dynamic'
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 const user=(await auth())?.user
 if(!canScout(user))return Response.json({error:'Scouter or administrator access required.'},{status:403})
 const {id}=await params
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return Response.json({error:'Invalid match.'},{status:400})
 const context=await reportContext(id)
 if(context.players?.length!==4)return Response.json({error:'Match needs four players.'},{status:422})
 return Response.json({localTest:process.env.SCOUT_LIVE_EXPERIMENT==='1',user:{id:user!.id},match:{id,names:context.players.map(p=>p.display_name||p.name),playerIds:context.players.map(p=>p.id),players:context.players,tournamentName:context.meta.tournament,round:context.meta.round,court:context.meta.court??null,category:context.meta.category}},{headers:{'Cache-Control':'no-store'}})
}
