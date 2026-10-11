import type {Pool} from 'pg'

export const MATCH_PAGE_SIZE=24
export function catalogFilters(params:Record<string,string|string[]|undefined>){
 const text=(key:string)=>typeof params[key]==='string'?(params[key] as string).slice(0,100):''
 const allowed=(key:string,values:string[])=>values.includes(text(key))?text(key):''
 return {q:text('q').trim(),status:allowed('status',['finished','live','scheduled','walkover','retired']),
  kind:allowed('kind',['match','private']),scouting:allowed('scouting',['scouted','unscouted']),
  scouter:text('scouter').trim(),date:/^\d{4}-\d{2}-\d{2}$/.test(text('date'))?text('date'):'',
  page:Math.max(1,Math.min(100000,Number.parseInt(text('page')||'1')||1))}
}
export type CatalogFilters=ReturnType<typeof catalogFilters>
export function catalogUrl(filters:CatalogFilters,changes:Partial<CatalogFilters>={}){
 const p=new URLSearchParams()
 for(const [key,value] of Object.entries({...filters,...changes}))if(value!==''&&(key!=='page'||value!==1))p.set(key,String(value))
 return '/scouting'+(p.size?'?'+p:'')
}
// Page lightweight metadata first. Never fetch or replay every scouting document.
export const CATALOG_SQL=`with sessions as (
 select match_id,updated_at,updated_by,assigned_scouter_user_id,'match'::text as kind,'video'::text as source from public.operator_video_scouting_sessions
 union all
 select match_id,updated_at,updated_by,assigned_scouter_user_id,'private','video' from public.operator_manual_video_scouting_sessions
 union all
 select match_id,updated_at,updated_by,null,'match','admin' from public.operator_scouting_sessions a
 where not exists(select 1 from public.operator_video_scouting_sessions v where v.match_id=a.match_id)
 ), catalog as (
 select m.id as match_id,'match'::text as kind,m.scheduled_at as sort_date,m.scheduled_at as match_date,
 m.status::text as match_status,m.duration,m.round,m.category,coalesce(t.name,'Tournament') as tournament_name,
 jsonb_build_array(
 jsonb_build_object('id',p1.id,'name',coalesce(p1.name,m.pair1_player1_name,'Player TBC'),'avatar_url',p1.avatar_url),
 jsonb_build_object('id',p2.id,'name',coalesce(p2.name,m.pair1_player2_name,'Player TBC'),'avatar_url',p2.avatar_url),
 jsonb_build_object('id',p3.id,'name',coalesce(p3.name,m.pair2_player1_name,'Player TBC'),'avatar_url',p3.avatar_url),
 jsonb_build_object('id',p4.id,'name',coalesce(p4.name,m.pair2_player2_name,'Player TBC'),'avatar_url',p4.avatar_url)) as players
 from public.matches m left join public.tournaments t on t.id=m.tournament_id
 left join public.players p1 on p1.id=m.pair1_player1_id left join public.players p2 on p2.id=m.pair1_player2_id
 left join public.players p3 on p3.id=m.pair2_player1_id left join public.players p4 on p4.id=m.pair2_player2_id
 union all
 select pm.id,'private',coalesce(pm.match_date::timestamptz,pm.created_at),pm.match_date::timestamptz,
 null,null,null,null,coalesce(nullif(pm.tournament_label,''),'Private match'),pm.players
 from public.operator_manual_scouting_matches pm
 ), filtered as (
 select c.*,s.source,s.updated_at,s.updated_by,s.assigned_scouter_user_id,u.email as assigned_email,
 (s.match_id is not null) as has_scouting
 from catalog c left join sessions s on s.match_id=c.match_id and s.kind=c.kind
 left join public.users u on u.id=s.assigned_scouter_user_id
 where ($1='' or c.players::text ilike '%'||$1||'%' or c.tournament_name ilike '%'||$1||'%')
 and ($2='' or c.match_status=$2) and ($3='' or c.kind=$3)
 and ($4='' or ($4='scouted' and s.match_id is not null) or ($4='unscouted' and s.match_id is null))
 and ($5='' or coalesce(u.email,s.updated_by,'') ilike '%'||$5||'%')
 and ($6='' or (c.match_date at time zone 'Europe/Madrid')::date::text=$6)
 ) select f.*,
 (select jsonb_agg(jsonb_build_object('a',st.pair1_games,'b',st.pair2_games) order by st.set_number) from public.sets st where st.match_id=f.match_id and f.kind='match') as official_sets,
 (f.kind='match' and (exists(select 1 from public.match_points mp where mp.match_id=f.match_id) or exists(select 1 from public.games g where g.match_id=f.match_id and cardinality(g.points)>0))) as has_pbp
 from filtered f order by sort_date desc nulls last,match_id desc,kind limit $7 offset $8`

export async function loadMatchCatalog(db:Pick<Pool,'query'>,filters:CatalogFilters){
 const {q,status,kind,scouting,scouter,date,page}=filters
 const result=await db.query(CATALOG_SQL,[q,status,kind,scouting,scouter,date,MATCH_PAGE_SIZE+1,(page-1)*MATCH_PAGE_SIZE])
 const rows=result.rows.slice(0,MATCH_PAGE_SIZE),hasNext=result.rows.length>MATCH_PAGE_SIZE
 const ids=rows.filter(r=>r.has_scouting).map(r=>r.match_id)
 if(ids.length){
  const saved=await db.query(`select match_id,'match' as kind,'video' as source,players,document,revision,score->>'phase' as phase from public.operator_video_scouting_sessions where match_id=any($1::uuid[])
   union all select match_id,'private','video',players,document,revision,score->>'phase' from public.operator_manual_video_scouting_sessions where match_id=any($1::uuid[])
   union all select match_id,'match','admin',players,document,revision,null from public.operator_scouting_sessions a where match_id=any($1::uuid[]) and not exists(select 1 from public.operator_video_scouting_sessions v where v.match_id=a.match_id)`,[ids])
  const byId=new Map(saved.rows.map(r=>[r.kind+':'+r.match_id,r]))
  for(const row of rows){const session=byId.get(row.kind+':'+row.match_id);if(session){
   // Saved roster order must match the scouting timeline; catalog avatars stay attached by ID.
   row.avatars=Object.fromEntries(row.players.filter((p:any)=>p.id).map((p:any)=>[p.id,p.avatar_url]))
   Object.assign(row,session)
  }}
 }
 return {rows,hasNext}
}
