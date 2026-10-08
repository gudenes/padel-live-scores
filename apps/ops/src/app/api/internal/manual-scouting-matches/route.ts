import {createHash,randomUUID} from 'node:crypto'
import {auth} from '@/lib/auth'
import {verifyScoutingProof} from '@/lib/scouting-extension-auth'
import {serviceClient} from '@/lib/supabase'
import {manualInput,manualDescriptor,matchUuid} from '../../../../../../../extensions/scouting-video-overlay/manual-match.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const table='operator_manual_scouting_matches'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function GET(req:Request){
 if(!(await auth())?.user?.isOperator)return json({error:'Sign in with an operator account.'},401)
 try{
  const db=serviceClient(),query=new URL(req.url).searchParams.get('players')
  if(query!==null){
   const term=query.trim().replace(/[%_]/g,'').slice(0,80)
   if(term.length<2)return json({players:[]})
   const result=await db.from('players').select('id,name,country,ranking').ilike('name','%'+term+'%').order('name').limit(8)
   if(result.error)throw Error('Player suggestions are unavailable. You can still type a new name.')
   return json({players:result.data??[]})
  }
  const result=await db.from(table).select('id,players,match_date,tournament_label,video_url,created_at').order('created_at',{ascending:false}).limit(200)
  if(result.error)throw Error('Private match storage is unavailable. The admin update may be pending.')
  return json({matches:(result.data??[]).map(manualDescriptor)})
 }catch(e){return json({error:e instanceof Error?e.message:'Private scouting unavailable.'},503)}
}
export async function POST(req:Request){
 const user=(await auth())?.user;if(!user?.isOperator)return json({error:'Sign in with an operator account.'},401)
 const url=new URL(req.url)
 if(req.headers.get('origin')!==`${url.protocol}//${req.headers.get('host')??url.host}`&&!verifyScoutingProof(req.headers.get('x-scouting-authorization'),user.id,req.headers.get('origin')))return json({error:'Sign in again. Your local work is retained.'},403)
 let input,id
 try{const text=await req.text();if(text.length>12000)return json({error:'Match details are too large.'},413);const body=JSON.parse(text);id=body.id;if(!matchUuid.test(id??''))throw Error('Invalid creation identifier.');input=manualInput(body)}catch(e){return json({error:e instanceof Error?e.message:'Check the match details.'},400)}
 try{
  const db=serviceClient(),hash=createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const existing=await db.from(table).select('*').eq('id',id).maybeSingle()
  if(existing.error)throw Error('Private match storage is unavailable. The admin update may be pending.')
  const acknowledge=(row:any)=>row.request_hash===hash?json({match:manualDescriptor(row)}):json({error:'This creation identifier belongs to different match details.'},409)
  if(existing.data)return acknowledge(existing.data)
  const linkedIds=input.players.flatMap(p=>p.id?[p.id]:[])
  const linked=linkedIds.length?await db.from('players').select('id,name,country,ranking').in('id',linkedIds):{data:[],error:null}
  if(linked.error||linked.data?.length!==linkedIds.length)return json({error:'An existing player is no longer available. Choose them again or enter a new name.'},400)
  const players=input.players.map(p=>{
   const resolved=linked.data?.find(x=>x.id===p.id)
   return resolved?{...resolved,existingPlayerId:resolved.id}:{id:randomUUID(),name:p.name,country:null,ranking:null,existingPlayerId:null}
  })
  if(new Set(players.map(p=>p.name.normalize('NFKC').toLocaleLowerCase())).size!==4)return json({error:'Choose four different players.'},400)
  const row={id,players,match_date:input.matchDate,tournament_label:input.tournamentLabel,video_url:input.videoUrl,request_hash:hash,created_by:user.email??user.id}
  const result=await db.from(table).insert(row).select('*').single()
  if(result.error?.code==='23505'){const retry=await db.from(table).select('*').eq('id',id).maybeSingle();if(retry.error||!retry.data)throw Error('Could not confirm the created match. Retry safely.');return acknowledge(retry.data)}
  if(result.error)throw Error('Could not create the match. Retry safely; no public data was changed.')
  return json({match:manualDescriptor(result.data)},201)
 }catch(e){return json({error:e instanceof Error?e.message:'Could not create this private match.'},503)}
}
