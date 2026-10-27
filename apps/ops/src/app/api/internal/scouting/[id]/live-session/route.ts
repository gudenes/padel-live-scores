import {auth} from '@/lib/auth'
import {canScout,canViewReports,canWriteSession} from '@/lib/scouting-permissions'
import {canonicalRoster} from '@/lib/video-scouting-api'
import {localLiveStore,liveLocalEnabled} from '@/lib/scouting/live-local-store'
import {validateVideoState,videoSummary} from '@/lib/scouting/live-server-model'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const store=localLiveStore(),uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
type Context={params:Promise<{id:string}>}
export async function GET(req:Request,{params}:Context){
 if(!liveLocalEnabled(req))return json({error:'Local live storage is disabled.'},404)
 const user=(await auth())?.user;if(!canViewReports(user))return json({error:'Scouting access required.'},403)
 const {id}=await params;if(!uuid.test(id))return json({error:'Invalid match.'},400)
 try{return json({session:await store.read(id),canResume:false,storage:'local-server'})}catch{return json({error:'Local server storage is unavailable.'},503)}
}
export async function POST(req:Request,{params}:Context){
 if(!liveLocalEnabled(req))return json({error:'Local live storage is disabled.'},404)
 const user=(await auth())?.user;if(!user?.id||!canScout(user))return json({error:'Scouter access required.'},403)
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Invalid origin.'},403)
 const {id}=await params;if(!uuid.test(id))return json({error:'Invalid match.'},400)
 let body:any,document:any
 try{const text=await req.text();if(text.length>1500000)return json({error:'Session is too large.'},413);body=JSON.parse(text);document=validateVideoState(body.document);if(document.captureMode==='standalone'||!uuid.test(body.writeId??'')||!Number.isInteger(body.revision)||body.revision<0||typeof body.completed!=='boolean')throw Error('Invalid save.');if(body.completed&&document.pending)throw Error('Finish or cancel the open rally first.')}catch(e){return json({error:(e as Error).message},400)}
 try{
  const row=await store.update(id,async old=>{
   const fail=(message:string,status:number)=>{throw Object.assign(Error(message),{status})}
   if(!canWriteSession(user,old))fail('This session belongs to another scouter.',403)
   if(old?.write_id===body.writeId){if(JSON.stringify(old.document)!==JSON.stringify(document)||old.completed!==body.completed)fail('Save identifier reused with different data.',409);return old}
   if((old?.revision??0)!==body.revision)fail('Session changed elsewhere. Export your local copy before resolving the conflict.',409)
   const players=old?.players??await canonicalRoster(id);if(!players)fail('Match not found.',404)
   const summary=videoSummary(document)
   return {match_id:id,document,players,score:summary.score,stats:summary.stats,revision:body.revision+1,write_id:body.writeId,completed:body.completed,updated_at:new Date().toISOString(),assigned_scouter_user_id:old?.assigned_scouter_user_id??user.id}
  })
  return json({revision:row.revision,savedAt:row.updated_at,completed:row.completed})
 }catch(e){return json({error:(e as Error).message},(e as {status?:number}).status??503)}
}
