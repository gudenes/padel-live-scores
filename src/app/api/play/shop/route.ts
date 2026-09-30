import {requirePlayAccess} from '@/lib/play-access'
import {isTrustedPlayWrite} from '@/lib/play-write-origin'
import {ensureBalance,playNotFound} from '../_shared'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
async function handle(req?:Request){
 const access=await requirePlayAccess()
 if(!access)return playNotFound()
 if(req&&!isTrustedPlayWrite(req))return Response.json({error:'invalid_origin'},{status:403,headers})
 const body=req?await req.json().catch(()=>null):{action:'read'}
 if(!body||!['read','buy','equip','avatar','remove_sticker'].includes(body.action))return Response.json({error:'invalid_action'},{status:400,headers})
 if(req&&body.action==='read')return Response.json({error:'invalid_action'},{status:400,headers})
 const wallet=await ensureBalance(access.supabase,access.userId)
 if(!wallet)return Response.json({error:'wallet_unavailable'},{status:503,headers})
 const {data,error}=await access.supabase.rpc('play_shop_update',{p_user:access.userId,p_season:wallet.seasonId,p_action:body.action,p_item:typeof body.item==='string'?body.item:null,p_avatar:typeof body.avatar==='string'?body.avatar:null})
 if(error){
  const known=['invalid_item','not_owned','performance_locked','insufficient_balance','invalid_avatar','invalid_action','wallet_unavailable','not_found'].find(code=>error.message.includes(code))
  if(!known)console.error('[shop] update failed',error.code)
  return Response.json({error:known??'save_failed'},{status:known==='not_found'?404:known?409:503,headers})
 }
 return Response.json(data,{headers})
}
export async function GET(){return handle()}
export async function POST(req:Request){return handle(req)}
