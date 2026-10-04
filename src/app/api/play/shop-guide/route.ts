import {requirePlayAccess} from '@/lib/play-access'
import {isTrustedPlayWrite} from '@/lib/play-write-origin'
import {playNotFound} from '../_shared'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET(){
 const access=await requirePlayAccess();if(!access)return playNotFound()
 const {data,error}=await access.supabase.from('play_shop_guide').select('user_id').eq('user_id',access.userId).maybeSingle()
 return error?json({error:'unavailable'},503):json({seen:!!data})
}
export async function POST(req:Request){
 const access=await requirePlayAccess();if(!access)return playNotFound()
 if(!isTrustedPlayWrite(req))return json({error:'invalid_origin'},403)
 const {error}=await access.supabase.from('play_shop_guide').upsert({user_id:access.userId},{onConflict:'user_id',ignoreDuplicates:true})
 return error?json({error:'save_failed'},503):json({ok:true})
}
