import {auth} from '@/lib/auth'
import {canScout,canWriteSession} from '@/lib/scouting-permissions'
import {serviceClient} from '@/lib/supabase'
export const dynamic='force-dynamic'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 const user=(await auth())?.user
 if(!user?.id||!canScout(user))return json({error:'Sign in with scouting access.'},401)
 const {id}=await params
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:'Invalid match.'},400)
 try{
  const db=serviceClient()
  const result=await db.from('matches').select('id,tournament_id,category,round,status,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id').eq('id',id).maybeSingle()
  if(result.error)throw Error('Match unavailable.')
  const m=result.data;if(!m)return json({error:'Match not found.'},404)
  const ids=[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id]
  if(ids.some(x=>!x)||new Set(ids).size!==4)return json({error:'This match needs four confirmed players before scouting.'},422)
  const [people,tournament,session]=await Promise.all([
   db.from('players').select('id,name,country,ranking,side').in('id',ids),
   db.from('tournaments').select('id,name').eq('id',m.tournament_id).maybeSingle(),
   db.from('operator_video_scouting_sessions').select('revision,document,updated_at,assigned_scouter_user_id,creator_user_id,write_id').eq('match_id',id).maybeSingle()
  ])
  if(people.error||tournament.error||session.error||people.data?.length!==4)throw Error('Could not load scouting. Please retry.')
  if(!canWriteSession(user,session.data))return json({error:'This match is assigned to another scouter. Ask an administrator to assign it to you.'},403)
  if(session.data&&session.data.document?.captureMode!=='standalone')return json({error:'This match already has extension scouting. Open its insights or continue in the extension; web scouting will not overwrite it.'},409)
  let resumeWarning:null|{creator:string;unknown:boolean}=null
  if(session.data&&session.data.creator_user_id!==user.id){
   const creatorId=session.data.creator_user_id
   const creator=creatorId?await db.from('users').select('email').eq('id',creatorId).maybeSingle():null
   resumeWarning={creator:creator?.data?.email??'Another scouter',unknown:!creatorId}
  }
  const players=ids.map(id=>people.data!.find(p=>p.id===id)!)
  return json({resumeWarning,user:{id:user.id,email:user.email},match:{id:m.id,tournamentId:m.tournament_id,tournamentName:tournament.data?.name??'Match',names:players.map(p=>p.name),playerIds:ids,players,category:m.category,round:m.round,status:m.status},session:session.data})
 }catch(e){return json({error:e instanceof Error?e.message:'Scouting unavailable.'},503)}
}
