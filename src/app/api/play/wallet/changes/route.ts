import {requirePlayAccess} from '@/lib/play-access'
import {isTrustedPlayWrite} from '@/lib/play-write-origin'
import {getActiveSeason} from '../../_shared'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
async function handle(req?:Request){
 const access=await requirePlayAccess()
 if(!access)return Response.json({error:'not_found'},{status:404,headers})
 if(req&&!isTrustedPlayWrite(req))return Response.json({error:'invalid_origin'},{status:403,headers})
 let ack:string|null=null
 if(req){const body=await req.json().catch(()=>null);ack=body?.id;if(typeof ack!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ack))return Response.json({error:'invalid_ack'},{status:400,headers})}
 const season=await getActiveSeason(access.supabase)
 if(!season)return Response.json({change:null},{headers})
 const {data,error}=await access.supabase.rpc('play_wallet_changes',{p_user:access.userId,p_season:season.id,p_ack:ack})
 if(error)return Response.json({error:'history_unavailable'},{status:503,headers})
 return Response.json(data,{headers})
}
export async function GET(){return handle()}
export async function POST(req:Request){return handle(req)}
