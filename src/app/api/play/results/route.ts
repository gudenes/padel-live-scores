import {requirePlayAccess} from '@/lib/play-access'
import {isTrustedPlayWrite} from '@/lib/play-write-origin'
import {playNotFound} from '../_shared'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET(){
 const access=await requirePlayAccess();if(!access)return playNotFound()
 // Include read rows before deduplication so superseded revisions cannot resurface.
 const {data,error}=await access.supabase.from('user_notifications').select('id,metadata,created_at,read_at').eq('user_id',access.userId).eq('category','play_result').gte('created_at',new Date(Date.now()-7*86400000).toISOString()).order('created_at',{ascending:false}).limit(100)
 if(error)return json({error:'unavailable'},503)
 const seen=new Set<string>()
 const items=(data??[]).filter(n=>{const id=n.metadata?.market_id;if(typeof id!=='string'||seen.has(id))return false;seen.add(id);return !n.read_at})
 return json({items})
}
export async function POST(req:Request){
 const access=await requirePlayAccess();if(!access)return playNotFound()
 if(!isTrustedPlayWrite(req))return json({error:'invalid_origin'},403)
 const body=await req.json().catch(()=>null)
 const ids=body?.ids??(body?.id?[body.id]:null)
 if(!Array.isArray(ids)||!ids.length||ids.length>100||!ids.every((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=100))return json({error:'invalid_id'},400)
 const {error}=await access.supabase.from('user_notifications').update({read_at:new Date().toISOString()}).eq('user_id',access.userId).eq('category','play_result').in('id',ids).is('read_at',null)
 return error?json({error:'save_failed'},503):json({ok:true})
}
