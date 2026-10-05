import {requirePlayAccess} from '@/lib/play-access'
import {invitationWindow} from '@/lib/play-invites'
import {playNotFound} from '../../_shared'
export async function GET(){
 const access=await requirePlayAccess()
 if(!access)return playNotFound()
 const headers={'Cache-Control':'private, no-store'}
 if(!invitationWindow()&&process.env.NODE_ENV==='production')return Response.json({eligible:false},{headers})
 // All-time trades, not current positions: settled/sold plays still count.
 const {data,error}=await access.supabase.from('market_trades').select('id').eq('user_id',access.userId).eq('direction','buy').limit(2)
 return Response.json({eligible:!error&&data?.length===1},{headers})
}
