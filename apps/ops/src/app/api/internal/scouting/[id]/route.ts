import {canScout} from '@/lib/scouting-permissions'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import {historyJson} from '@/lib/scouting/history'
import { validateDoc } from '@/lib/scouting/model'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
async function roster(id:string){
  const db=serviceClient()
  const r=await db.from('matches').select('id,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id').eq('id',id).maybeSingle()
  if(r.error)throw Error('Match data unavailable.')
  if(!r.data)return null
  const ids=[r.data.pair1_player1_id,r.data.pair1_player2_id,r.data.pair2_player1_id,r.data.pair2_player2_id]
  if(ids.some(x=>!x)||new Set(ids).size!==4)throw Error('Four confirmed players are required before scouting.')
  const p=await db.from('players').select('id,name,avatar_url,photo_url').in('id',ids)
  if(p.error||p.data?.length!==4)throw Error('Player data unavailable.')
  return ids.map(id=>p.data!.find(p=>p.id===id)!)
}
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}){
  if(!canScout((await auth())?.user))return json({error:'unauthorized'},401)
  const {id}=await ctx.params;if(!uuid.test(id))return json({error:'Invalid match.'},400)
  try{
    const session=await serviceClient().from('operator_scouting_sessions').select('*').eq('match_id',id).maybeSingle()
    if(session.error)throw Error('Scouting storage is unavailable.')
    const players=session.data?.players??await roster(id)
    if(!players)return json({error:'Match not found.'},404)
    return json({players,session:session.data})
  }catch(e){return json({error:e instanceof Error?e.message:'Scouting unavailable.'},503)}
}
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){
  const user=(await auth())?.user;if(!user?.isOperator)return json({error:'unauthorized'},401)
  const url=new URL(req.url)
  if(req.headers.get('origin')!==`${url.protocol}//${req.headers.get('host')??url.host}`)return json({error:'Invalid origin.'},403)
  const {id}=await ctx.params;if(!uuid.test(id))return json({error:'Invalid match.'},400)
  let body,doc
  try{const text=await req.text();if(text.length>1500000)return json({error:'Session is too large.'},413);body=JSON.parse(text);doc=validateDoc(body.document);if(!Number.isInteger(body.revision)||body.revision<0)throw Error('Invalid revision.')}
  catch(e){return json({error:e instanceof Error?e.message:'Invalid request.'},400)}
  try{
    const db=serviceClient(),old=await db.from('operator_scouting_sessions').select('*').eq('match_id',id).maybeSingle()
    if(old.error)throw Error('Scouting storage is unavailable.')
    if((old.data?.revision??0)!==body.revision)return json({error:'This session changed in another window. Download your local copy, then reload to resume.'},409)
    if(old.data){
      const prior=old.data.document
      if(historyJson({...prior,events:[]})!==historyJson({...doc,events:[]})||historyJson(doc.events.slice(0,prior.events.length))!==historyJson(prior.events))return json({error:'Session history must be appended. Use Undo to correct a point.'},400)
    }
    const players=old.data?.players??await roster(id)
    if(!players)return json({error:'Match not found.'},404)
    const row={match_id:id,revision:body.revision+1,document:doc,players,updated_by:user.email??'operator',updated_at:new Date().toISOString()}
    const saved=old.data?await db.from('operator_scouting_sessions').update(row).eq('match_id',id).eq('revision',body.revision).select('revision').maybeSingle():await db.from('operator_scouting_sessions').insert(row).select('revision').single()
    if(saved.error?.code==='23505'||!saved.error&&!saved.data)return json({error:'This session changed in another window. Download your local copy, then reload.'},409)
    if(saved.error)throw Error('Could not save. Your local copy is retained.')
    return json({revision:saved.data!.revision})
  }catch(e){return json({error:e instanceof Error?e.message:'Could not save.'},503)}
}
