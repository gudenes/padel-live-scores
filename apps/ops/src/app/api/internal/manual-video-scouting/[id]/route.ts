import {videoScoutingApi} from '@/lib/video-scouting-api'
import {serviceClient} from '@/lib/supabase'
export const runtime='nodejs'
export const dynamic='force-dynamic'
async function metadata(id:string){
 const result=await serviceClient().from('operator_manual_scouting_matches').select('id,players,match_date,tournament_label,video_url,created_at').eq('id',id).maybeSingle()
 if(result.error)throw Error('Private match storage is unavailable.')
 return result.data
}
export const {GET,POST}=videoScoutingApi({table:'operator_manual_video_scouting_sessions',roster:async id=>(await metadata(id))?.players??null,metadata})
