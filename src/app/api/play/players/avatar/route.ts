import {requirePlayAccess} from '@/lib/play-access'
import {readProductionAvatar} from '@/lib/production-avatar-store'
import {SHOP_AVATARS,SHOP_ITEMS} from '@/lib/avatar-shop'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
const empty=(status=404)=>new Response(null,{status,headers})
export async function GET(req:Request){
 const access=await requirePlayAccess()
 if(!access)return empty()
 const url=new URL(req.url), userId=url.searchParams.get('userId')??''
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(userId))return empty()
 // Shared appearance is visible to Play members only, for other current members.
 const member=await access.supabase.from('play_access').select('user_id').eq('user_id',userId).maybeSingle()
 if(member.error)return empty(503)
 if(!member.data)return empty()
 const wardrobe=await access.supabase.from('play_wardrobes').select('avatar,equipped').eq('user_id',userId).maybeSingle()
 if(wardrobe.error)return empty(503)
 if(!wardrobe.data)return empty()
 const avatar=wardrobe.data.avatar as string
 const custom=/^custom:[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(avatar)
 if(!custom&&!SHOP_AVATARS.some(a=>a.id===avatar))return empty()
 if(url.searchParams.get('image')==='1'){
  if(!custom)return empty()
  // Never accept an asset ID from the caller: only the target's equipped image.
  try {const bytes=await readProductionAvatar(access.supabase,userId,avatar.slice(7));return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/png'}})}
  catch{return empty()}
 }
 const equipped=Object.fromEntries(Object.entries(wardrobe.data.equipped??{}).filter(([slot,id])=>SHOP_ITEMS.some(item=>item.id===id&&item.slot===slot)))
 return Response.json({avatar,equipped},{headers})
}
