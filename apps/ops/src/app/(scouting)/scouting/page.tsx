import Link from 'next/link'
import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {redirect} from 'next/navigation'
import {pgPool} from '@/lib/db'
import {librarySummary,libraryDuration} from '@/lib/scouting/library-summary'
import InsightLink from './InsightLink'
import styles from './library.module.css'
export const dynamic='force-dynamic'
export const metadata={title:'All scouted matches · Padel Nachos'}
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=(await auth())?.user;if(!canViewReports(user))redirect('/login')
 const params=await searchParams
 const text=(k:string)=>typeof params[k]==='string'?(params[k] as string).slice(0,100):''
 const q=text('q'),status=text('status'),kind=text('kind'),scouter=text('scouter'),date=text('date')
 const page=Math.max(1,Math.min(100000,Number.parseInt(text('page')||'1')||1))
 let rows:any[]=[];let failed=false
 try{
 const result=await pgPool().query(`with sessions as (
 select match_id,players,updated_at,updated_by,score->>'phase' as phase,assigned_scouter_user_id,'match' as kind,true as can_assign,document,revision,'video' as source from public.operator_video_scouting_sessions
 union all
 select match_id,players,updated_at,updated_by,score->>'phase',assigned_scouter_user_id,'private',true,document,revision,'video' from public.operator_manual_video_scouting_sessions
 union all
 select match_id,players,updated_at,updated_by,null,null,'match',false,document,revision,'admin' from public.operator_scouting_sessions a
 where not exists(select 1 from public.operator_video_scouting_sessions v where v.match_id=a.match_id)
 ), reports as (
 select s.*,coalesce(t.name,nullif(pm.tournament_label,''),'Private match') as tournament_name,
 coalesce(m.scheduled_at::date,pm.match_date) as match_date,u.email as assigned_email,m.duration,m.round,m.category,
 (select jsonb_agg(jsonb_build_object('a',st.pair1_games,'b',st.pair2_games) order by st.set_number) from public.sets st where st.match_id=m.id) as official_sets,
 (select jsonb_object_agg(p.id::text,p.avatar_url) from public.players p where p.id::text in (select item->>'id' from jsonb_array_elements(s.players) item)) as avatars
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
 return <main className={styles.page}><div className={styles.eyebrow}>YOUR SCOUTING LIBRARY</div><h1>Scouted matches</h1><p>View everyone’s saved insights.{!user?.isViewer && <> To record a match, open the Padel Nachos extension and choose New match.</>}</p><p><Link href="/scouting/methodology">Calculation methodology</Link>{user?.isOperator&&<> · <Link href="/team-access">Team access</Link></>}</p>
 <form className="ui-panel" style={{padding:16,display:'flex',gap:12,flexWrap:'wrap',alignItems:'end'}}>
 <label>Players or tournament<input className="ui-input" name="q" defaultValue={q}/></label>
 <label>Scouter<input className="ui-input" name="scouter" defaultValue={scouter}/></label>
 <label>Match date<input className="ui-input" type="date" name="date" defaultValue={date}/></label>
 <label>Status<select className="ui-input" name="status" defaultValue={status}><option value="">All</option><option value="finished">Finished</option><option value="in-progress">In progress / legacy</option></select></label>
 <label>Type<select className="ui-input" name="kind" defaultValue={kind}><option value="">All</option><option value="match">Tournament</option><option value="private">Private</option></select></label>
 <button className="ui-btn" data-variant="primary">Search</button></form>
 <div className={styles.grid}>
 {failed?<p role="alert">Could not load reports. Please retry; the access database update may be pending.</p>:!rows.length?<p className="ui-panel">No scouted matches match these filters. <Link href="/scouting">Reset filters</Link></p>:rows.slice(0,50).map(r=>{
 const summary=librarySummary(r,r.source)
 const official=Array.isArray(r.official_sets)?r.official_sets.filter((s:any)=>Number.isInteger(s.a)&&Number.isInteger(s.b)):[]
 const sets=official.length?official:summary.sets
 const duration=libraryDuration(r.duration)
 return <article key={r.kind+r.match_id} className={styles.card}>
 <div className={styles.cardTop}><span className={styles.badge} data-state={summary.failed?'review':r.phase==='finished'?'finished':'progress'}>{summary.failed?'Needs review':r.phase==='finished'?'Finished':'In progress / legacy'}</span><span>{r.match_date?new Date(r.match_date).toLocaleDateString('en-GB',{timeZone:'Europe/Madrid',day:'2-digit',month:'short',year:'numeric'}):'Date unavailable'}</span></div>
 <h2>{r.tournament_name}</h2><p className={styles.sub}>{[r.round,r.category,r.kind==='private'?'Private match':'Tournament match'].filter(Boolean).join(' · ')}</p>
 <div className={styles.scoreLabel}>{official.length?'Official result':'Scouting score'} · Player Score / 10</div>
 {[0,1].map(team=><div className={styles.team} key={team}><div className={styles.pair}>{r.players.slice(team*2,team*2+2).map((p:any,i:number)=>{const rating=summary.ratings[team*2+i],avatar=r.avatars?.[p.id]??p.avatar_url??p.photo_url;return <div className={styles.player} key={p.id??i}>{avatar?<img className={styles.avatar} src={avatar} alt="" loading="lazy"/>:<span className={styles.avatarFallback} aria-hidden="true">{p.name?.slice(0,1)}</span>}<span>{p.name}</span><span className={styles.rating} data-high={rating!==null&&rating>=9} title={`Player Score · v1.5${summary.partial?' · Partial observation':''}`}>{rating===null?'—':rating.toFixed(1)}</span></div>})}</div><div className={styles.sets}>{sets.length?sets.map((set:any,i:number)=><span key={i} aria-label={`Set ${i+1}: ${team===0?set.a:set.b}`}><small>S{i+1}</small><b>{team===0?set.a:set.b}</b></span>):<span>—</span>}</div></div>)}
 <div className={styles.meta}><span>{summary.points===null?'Stats unavailable':`${summary.points} points scouted`}{summary.partial?' · Partial':''}</span><span>Total match time <strong>{duration??'Unavailable'}</strong></span></div>
 <footer><div><strong>Saved to server</strong><small>Scouter: {r.assigned_email??'Administrator / unassigned'}</small><small>Saved {new Date(r.updated_at).toLocaleString('en-GB',{timeZone:'Europe/Madrid'})}</small></div><InsightLink href={`/scouting/${r.kind==='private'?'manual/':''}${r.match_id}/report`}/></footer>
 {user?.isOperator&&r.can_assign&&<div className={styles.assign}><Link href={`/team-access?match=${r.match_id}&kind=${r.kind}`}>Assign scouter</Link></div>}
 </article>})}</div>
 <nav style={{display:'flex',gap:20,marginTop:20}}>{page>1&&<Link href={pageUrl(page-1)}>Previous</Link>}{rows.length>50&&<Link href={pageUrl(page+1)}>Next</Link>}</nav></main>
}
