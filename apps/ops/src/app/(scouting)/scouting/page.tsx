import Link from 'next/link'
import {auth} from '@/lib/auth'
import {canScout} from '@/lib/scouting-permissions'
import {redirect} from 'next/navigation'
import {pgPool} from '@/lib/db'
export const dynamic='force-dynamic'
export const metadata={title:'All scouted matches · Padel Nachos'}
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=(await auth())?.user;if(!canScout(user))redirect('/login')
 const params=await searchParams
 const text=(k:string)=>typeof params[k]==='string'?(params[k] as string).slice(0,100):''
 const q=text('q'),status=text('status'),kind=text('kind'),scouter=text('scouter'),date=text('date')
 const page=Math.max(1,Math.min(100000,Number.parseInt(text('page')||'1')||1))
 let rows:any[]=[];let failed=false
 try{
 const result=await pgPool().query(`with sessions as (
 select match_id,players,updated_at,updated_by,score->>'phase' as phase,assigned_scouter_user_id,'match' as kind,true as can_assign from public.operator_video_scouting_sessions
 union all
 select match_id,players,updated_at,updated_by,score->>'phase',assigned_scouter_user_id,'private',true from public.operator_manual_video_scouting_sessions
 union all
 select match_id,players,updated_at,updated_by,null,null,'match',false from public.operator_scouting_sessions a
 where not exists(select 1 from public.operator_video_scouting_sessions v where v.match_id=a.match_id)
 ), reports as (
 select s.*,coalesce(t.name,pm.tournament_label,'Private match') as tournament_name,
 coalesce(m.scheduled_at::date,pm.match_date) as match_date,u.email as assigned_email
 from sessions s left join public.matches m on s.kind='match' and m.id=s.match_id
 left join public.tournaments t on t.id=m.tournament_id
 left join public.operator_manual_scouting_matches pm on s.kind='private' and pm.id=s.match_id
 left join public.users u on u.id=s.assigned_scouter_user_id
 ) select * from reports where ($1='' or players::text ilike '%'||$1||'%' or tournament_name ilike '%'||$1||'%')
 and ($2='' or ($2='finished' and phase='finished') or ($2='in-progress' and coalesce(phase,'')<>'finished'))
 and ($3='' or kind=$3) and ($4='' or coalesce(assigned_email,updated_by) ilike '%'||$4||'%')
 and ($5='' or match_date::text=$5) order by updated_at desc,match_id limit 51 offset $6`,[q,status,kind,scouter,date,(page-1)*50])
 rows=result.rows
 }catch{failed=true}
 const pageUrl=(n:number)=>{const p=new URLSearchParams({q,status,kind,scouter,date,page:String(n)});return '/scouting?'+p}
 return <main style={{padding:24,maxWidth:1300,margin:'auto'}}><h1>All scouted matches</h1><p>View everyone’s saved insights. To record a match, open the Padel Nachos extension and choose New match.</p><p><Link href="/scouting/methodology">Calculation methodology</Link>{user?.isOperator&&<> · <Link href="/team-access">Manage scouters</Link></>}</p>
 <form className="ui-panel" style={{padding:16,display:'flex',gap:12,flexWrap:'wrap',alignItems:'end'}}>
 <label>Players or tournament<input className="ui-input" name="q" defaultValue={q}/></label>
 <label>Scouter<input className="ui-input" name="scouter" defaultValue={scouter}/></label>
 <label>Match date<input className="ui-input" type="date" name="date" defaultValue={date}/></label>
 <label>Status<select className="ui-input" name="status" defaultValue={status}><option value="">All</option><option value="finished">Finished</option><option value="in-progress">In progress / legacy</option></select></label>
 <label>Type<select className="ui-input" name="kind" defaultValue={kind}><option value="">All</option><option value="match">Tournament</option><option value="private">Private</option></select></label>
 <button className="ui-btn" data-variant="primary">Search</button></form>
 {failed?<p role="alert">Could not load reports. Please retry; the access database update may be pending.</p>:!rows.length?<p>No scouted matches match these filters.</p>:rows.slice(0,50).map(r=><article key={r.kind+r.match_id} className="ui-panel" style={{marginTop:14,padding:20}}><h2 style={{fontSize:18}}>{r.players.slice(0,2).map((p:any)=>p.name).join(' / ')} vs {r.players.slice(2).map((p:any)=>p.name).join(' / ')}</h2><p>{r.tournament_name} · {r.phase==='finished'?'Finished':'In progress / legacy'} · {r.kind==='private'?'Private match':'Tournament match'}</p><p>Scouter: {r.assigned_email??'Administrator / unassigned'} · Last saved {new Date(r.updated_at).toLocaleString('en-GB',{timeZone:'Europe/Madrid'})}</p><Link className="ui-btn" href={`/scouting/${r.kind==='private'?'manual/':''}${r.match_id}/report`}>Open insights</Link>{user?.isOperator&&r.can_assign&&<> <Link className="ui-btn" href={`/team-access?match=${r.match_id}&kind=${r.kind}`}>Assign scouter</Link></>}</article>)}
 <nav style={{display:'flex',gap:20,marginTop:20}}>{page>1&&<Link href={pageUrl(page-1)}>Previous</Link>}{rows.length>50&&<Link href={pageUrl(page+1)}>Next</Link>}</nav></main>
}
