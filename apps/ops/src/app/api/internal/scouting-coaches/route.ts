import {auth} from '@/lib/auth'
import {canScout} from '@/lib/scouting-permissions'
import {serviceClient} from '@/lib/supabase'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function GET(request:Request){
 if(!canScout((await auth())?.user))return json({error:'Scouting access required.'},401)
 const ids=[...new Set((new URL(request.url).searchParams.get('players')??'').split(',').filter(Boolean))]
 if(!ids.length||ids.length>4||ids.some(id=>!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))return json({error:'Choose up to four players.'},400)
 const result=await serviceClient().from('player_coaches_public').select('player_id,coach_id,display_name').in('player_id',ids)
 if(result.error)return json({error:'Coach suggestions unavailable. Please retry.'},503)
 return json({coaches:(result.data??[]).map(c=>({playerId:c.player_id,id:c.coach_id,name:c.display_name}))})
}
