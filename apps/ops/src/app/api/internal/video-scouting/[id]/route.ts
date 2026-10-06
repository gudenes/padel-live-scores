import {auth} from '@/lib/auth'
import {serviceClient} from '@/lib/supabase'
import {historyJson} from '@/lib/scouting/history'
import {validateVideoState,videoSummary} from '../../../../../../../../extensions/scouting-video-overlay/server-model.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const table='operator_video_scouting_sessions'
async function roster(id:string){
 const db=serviceClient(),row=await db.from('matches').select('id,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id').eq('id',id).maybeSingle()
 if(row.error)throw Error('Match data unavailable.')
 if(!row.data)return null
 const ids=[row.data.pair1_player1_id,row.data.pair1_player2_id,row.data.pair2_player1_id,row.data.pair2_player2_id]
 if(ids.some(x=>!x)||new Set(ids).size!==4)throw Error('Four confirmed players are required.')
 const people=await db.from('players').select('id,name').in('id',ids)
 if(people.error||people.data?.length!==4)throw Error('Player data unavailable.')
 return ids.map(id=>people.data!.find(p=>p.id===id)!)
}
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}){
 if(!(await auth())?.user?.isOperator)return json({error:'Sign in to admin as an operator.'},401)
 const {id}=await ctx.params;if(!uuid.test(id))return json({error:'Invalid match.'},400)
 try{
  const result=await serviceClient().from(table).select('revision,document,score,stats,players,updated_at').eq('match_id',id).maybeSingle()
  if(result.error)throw Error('Video scouting storage is unavailable.')
  return json({session:result.data,features:['smash-types-v1','var-review-v1','rally-touches-v1','point-tags-v2']})
 }catch(e){return json({error:e instanceof Error?e.message:'Scouting unavailable.'},503)}
}
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){
 const user=(await auth())?.user;if(!user?.isOperator)return json({error:'Sign in to admin as an operator.'},401)
 const url=new URL(req.url)
 if(req.headers.get('origin')!==`${url.protocol}//${req.headers.get('host')??url.host}`)return json({error:'Invalid origin.'},403)
 const {id}=await ctx.params;if(!uuid.test(id))return json({error:'Invalid match.'},400)
 let body,document
 try{
  const text=await req.text();if(text.length>1500000)return json({error:'Session is too large.'},413)
  body=JSON.parse(text);document=validateVideoState(body.document)
  if(!Number.isInteger(body.revision)||body.revision<0||!uuid.test(body.writeId??''))throw Error('Invalid save revision.')
 }catch(e){return json({error:e instanceof Error?e.message:'Invalid request.'},400)}
 try{
  const db=serviceClient(),old=await db.from(table).select('*').eq('match_id',id).maybeSingle()
  if(old.error)throw Error('Video scouting storage is unavailable.')
  // Retried requests after a lost response acknowledge the original save.
  if(old.data?.write_id===body.writeId){
   if(historyJson(old.data.document)!==historyJson(document))return json({error:'Save identifier was reused with different data.'},409)
   return json({revision:old.data.revision,score:old.data.score,savedAt:old.data.updated_at})
  }
  if((old.data?.revision??0)!==body.revision)return json({error:'This match was changed elsewhere. Your local copy is retained. Load the server copy before continuing.'},409)
  const players=old.data?.players??await roster(id);if(!players)return json({error:'Match not found.'},404)
  const summary=videoSummary(document),updatedAt=new Date().toISOString()
  const row={match_id:id,revision:body.revision+1,write_id:body.writeId,document,score:summary.score,stats:summary.stats,players,updated_by:user.email??'operator',updated_at:updatedAt}
  const saved=old.data?await db.from(table).update(row).eq('match_id',id).eq('revision',body.revision).select('revision').maybeSingle():await db.from(table).insert(row).select('revision').single()
  if(saved.error?.code==='23505'||!saved.error&&!saved.data)return json({error:'This match was changed elsewhere. Your local copy is retained.'},409)
  if(saved.error)throw Error('Could not save. Your local copy is retained.')
  return json({revision:saved.data!.revision,score:summary.score,savedAt:updatedAt})
 }catch(e){return json({error:e instanceof Error?e.message:'Could not save.'},503)}
}
