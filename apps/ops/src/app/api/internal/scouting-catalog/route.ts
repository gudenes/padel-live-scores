import { canScout } from '@/lib/scouting-permissions'
import {auth} from '@/lib/auth'
import {serviceClient} from '@/lib/supabase'
export const dynamic='force-dynamic'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
const slots=['pair1_player1','pair1_player2','pair2_player1','pair2_player2'] as const
export async function GET(req:Request){
 if(!canScout((await auth())?.user))return json({error:'Sign in with an scouting account.'},401)
 const params=new URL(req.url).searchParams,start=params.get('start'),end=params.get('end'),q=(params.get('q')??'').trim().slice(0,80)
 if(start||end){const a=Date.parse(start??''),b=Date.parse(end??'');if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>26*3600000)return json({error:'Choose a valid day.'},400)}
 else if(q.length<2)return json({error:'Type at least two characters to search other matches.'},400)
 try{
  const db=serviceClient()
  let query=db.from('matches').select('id,tournament_id,status,category,round,scheduled_at,duration,sets(set_number,pair1_games,pair2_games),'+slots.map(s=>s+'_id,'+s+'_name').join(','))
  if(start&&end)query=query.gte('scheduled_at',start).lt('scheduled_at',end)
  // Resolve the first search term into canonical player/tournament IDs, then match all words below.
  if(q){
   const term=q.split(/\s+/)[0].replace(/[^\p{L}\p{N} -]/gu,'')
   if(!term)return json({matches:[],tournaments:[]})
   const [ps,ts]=await Promise.all([db.from('players').select('id').or('name.ilike.%'+term+'%,normalized_name.ilike.%'+term.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()+'%').limit(500),db.from('tournaments').select('id').ilike('name','%'+term+'%').limit(100)])
   if(ps.error||ts.error)throw Error('Search is unavailable. Try again.')
   const ids=(ps.data??[]).map(p=>p.id),tids=(ts.data??[]).map(t=>t.id),filters=slots.map(s=>s+'_name.ilike.%'+term+'%')
   if(ids.length)for(const s of slots)filters.push(s+'_id.in.('+ids.join(',')+')')
   if(tids.length)filters.push('tournament_id.in.('+tids.join(',')+')')
   query=query.or(filters.join(','))
  }
  const result=await query.order('scheduled_at',{ascending:!!start,nullsFirst:false}).limit(250)
  if(result.error)throw Error('Could not load matches. Retry shortly.')
  const rows=(result.data??[]) as unknown as Array<Record<string,any>>
  const playerIds=[...new Set(rows.flatMap(m=>slots.map(s=>m[s+'_id']).filter(Boolean)))],tournamentIds=[...new Set(rows.map(m=>m.tournament_id).filter(Boolean))]
  const [ps,ts]=await Promise.all([playerIds.length?db.from('players').select('id,name,country,ranking,side').in('id',playerIds):{data:[],error:null},tournamentIds.length?db.from('tournaments').select('id,name,country,level,starts_at,ends_at').in('id',tournamentIds):{data:[],error:null}])
  if(ps.error||ts.error)throw Error('Could not load player profiles. Retry shortly.')
  const players=new Map((ps.data??[]).map(p=>[p.id,p])),tournaments=(ts.data??[]).map(t=>({id:t.id,name:t.name,country:t.country,level:t.level,startsAt:t.starts_at,endsAt:t.ends_at}))
  const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const matches=rows.map(m=>({id:m.id,tournamentId:m.tournament_id,names:slots.map(s=>players.get(m[s+'_id'])?.name??m[s+'_name']),playerIds:slots.map(s=>m[s+'_id']),players:slots.map(s=>{const p=players.get(m[s+'_id']);return {country:p?.country??null,ranking:p?.ranking??null,side:p?.side??null}}),category:m.category,round:m.round,status:m.status,duration:typeof m.duration==='string'&&/^\d{1,2}:[0-5]\d$/.test(m.duration)&&Number(m.duration.split(':')[0])*60+Number(m.duration.split(':')[1])<=240?m.duration:null,sets:(Array.isArray(m.sets)?m.sets:[]).filter((s:any)=>Number.isInteger(s.pair1_games)&&Number.isInteger(s.pair2_games)).sort((a:any,b:any)=>a.set_number-b.set_number).map((s:any)=>({a:s.pair1_games,b:s.pair2_games})),scheduledAt:m.scheduled_at,tournamentName:tournaments.find(t=>t.id===m.tournament_id)?.name??''})).filter(m=>m.tournamentId&&m.names.every(n=>typeof n==='string'&&n.trim())&&normalize(q).split(/\s+/).every(term=>normalize(m.names.join(' ')+' '+m.tournamentName).includes(term)))
  return json({matches,tournaments,truncated:rows.length===250,loadedAt:new Date().toISOString()})
 }catch(e){return json({error:e instanceof Error?e.message:'Match search unavailable.'},503)}
}
