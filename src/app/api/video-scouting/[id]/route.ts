import {createServiceClient,createAnonServerClient} from '@/lib/supabase'
import {publicReport} from '../../../../../extensions/scouting-video-overlay/public-report.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return Response.json({error:'Invalid match'},{status:400});
 try{
  // Respect public match visibility before accessing the private operator table.
  const visible=await createAnonServerClient().from('matches').select('id').eq('id',id).maybeSingle();
  if(visible.error)return Response.json({error:'Match unavailable'},{status:503});
  if(!visible.data)return Response.json({report:null},{status:404});
  const saved=await createServiceClient().from('operator_video_scouting_sessions').select('document,players,updated_at').eq('match_id',id).maybeSingle();
  if(saved.error)return Response.json({error:'Scouting unavailable'},{status:503});
  return Response.json({report:publicReport(saved.data)},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Scouting unavailable'},{status:503});}
}
