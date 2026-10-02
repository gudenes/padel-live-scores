import {isTrustedPlayWrite} from '@/lib/play-write-origin'
import {requirePlayAccess} from '@/lib/play-access'
import {paginatedSelect} from '@/lib/db-paginate'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers})
export async function GET(req:Request){
 const access=await requirePlayAccess()
 if(!access)return reply({error:'not_found'},404)
 const target=new URL(req.url).searchParams.get('userId')??access.userId
 if(!uuid.test(target))return reply({error:'invalid_target'},400)
 const {supabase,userId}=access
 const member=await supabase.from('play_access').select('user_id').eq('user_id',target).maybeSingle()
 if(member.error)return reply({error:'unavailable'},503)
 if(!member.data)return reply({error:'not_found'},404)
 try{
  const [following,followersCount,followingCount]=await Promise.all([
   paginatedSelect<{following_id:string}>((a,b)=>supabase.from('play_member_follows').select('following_id').eq('follower_id',userId).order('following_id').range(a,b),{what:'member follows'}),
   supabase.from('play_member_follows').select('*',{count:'exact',head:true}).eq('following_id',target),
   supabase.from('play_member_follows').select('*',{count:'exact',head:true}).eq('follower_id',target),
  ])
  if(followersCount.error||followingCount.error)throw Error()
  return reply({followingIds:following.map(f=>f.following_id),followers:followersCount.count??0,following:followingCount.count??0})
 }catch{return reply({error:'unavailable'},503)}
}
export async function POST(req:Request){
 const access=await requirePlayAccess()
 if(!access)return reply({error:'not_found'},404)
 // Cookie-authenticated mutations must originate from this app.
 if(!isTrustedPlayWrite(req))return reply({error:'invalid_origin'},403)
 let body:{userId?:unknown;follow?:unknown}
 try{body=await req.json()}catch{return reply({error:'invalid_request'},400)}
 if(typeof body.userId!=='string'||!uuid.test(body.userId)||typeof body.follow!=='boolean'||body.userId===access.userId)return reply({error:'invalid_target'},400)
 const {supabase,userId}=access
 const member=await supabase.from('play_access').select('user_id').eq('user_id',body.userId).maybeSingle()
 if(member.error)return reply({error:'unavailable'},503)
 if(!member.data)return reply({error:'not_found'},404)
 const result=body.follow
  ?await supabase.from('play_member_follows').upsert({follower_id:userId,following_id:body.userId},{onConflict:'follower_id,following_id',ignoreDuplicates:true})
  :await supabase.from('play_member_follows').delete().eq('follower_id',userId).eq('following_id',body.userId)
 if(result.error)return reply({error:'unavailable'},503)
 return reply({following:body.follow})
}
