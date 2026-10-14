import type {Pool} from 'pg'

export const MATCH_PAGE_SIZE=24
export const LEAGUE_GROUPS=[
 {label:'Premier Padel',options:[['premier','All Premier Padel'],['major','Major'],['p1','P1'],['p2','P2'],['finals','Finals']]},
 {label:'FIP',options:[['fip','All FIP'],['fip_platinum','Platinum'],['fip_gold','Gold'],['fip_silver','Silver'],['fip_bronze','Bronze'],['fip_finals','Finals'],['fip_championship','Championship'],['fip_promises','Promises'],['fip_beyond','Beyond'],['fip_other','Other FIP']]}
]
export function catalogFilters(params:Record<string,string|string[]|undefined>){
 const text=(key:string)=>typeof params[key]==='string'?(params[key] as string).slice(0,100):''
 const allowed=(key:string,values:string[])=>values.includes(text(key))?text(key):''
 const watchlist=allowed('watchlist',['1'])
 const rawPlayers=typeof params.watched==='string'?params.watched:''
 const watched=watchlist?[...new Set(rawPlayers.split(',').filter(id=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))].slice(0,50).join(','):''
 return {watchlist,watched,mine:allowed('mine',['1']),player:/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text('player'))?text('player'):'',league:allowed('league',LEAGUE_GROUPS.flatMap(g=>g.options.map(([value])=>value))),q:text('q').trim(),status:allowed('status',['finished','live','scheduled','walkover','retired']),
  kind:allowed('kind',['match','private']),scouting:allowed('scouting',['scouted','unscouted','pending']),
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
 select match_id,updated_at,updated_by,assigned_scouter_user_id,creator_user_id,score->>'phase' as scout_phase,'match'::text as kind,'video'::text as source from public.operator_video_scouting_sessions
 union all
 select match_id,updated_at,updated_by,assigned_scouter_user_id,creator_user_id,score->>'phase','private','video' from public.operator_manual_video_scouting_sessions
 union all
 select match_id,updated_at,updated_by,null,null,null,'match','admin' from public.operator_scouting_sessions a
 where not exists(select 1 from public.operator_video_scouting_sessions v where v.match_id=a.match_id)
 ), catalog as (
 select m.id as match_id,'match'::text as kind,m.scheduled_at as sort_date,m.scheduled_at as match_date,
 t.level as league_tier,m.status::text as match_status,m.duration,m.round,m.category,coalesce(t.name,'Tournament') as tournament_name,
 null::jsonb as players,
 array[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id] as player_ids,
 array[m.pair1_player1_name,m.pair1_player2_name,m.pair2_player1_name,m.pair2_player2_name] as player_names
 from public.matches m left join public.tournaments t on t.id=m.tournament_id
 union all
 select pm.id,'private',coalesce(pm.match_date::timestamptz,pm.created_at),pm.match_date::timestamptz,
 null,null,null,null,null,coalesce(nullif(pm.tournament_label,''),'Private match'),pm.players,null::uuid[],null::text[]
 from public.operator_manual_scouting_matches pm
 ), filtered as (
 select c.*,s.source,s.updated_at,s.updated_by,s.assigned_scouter_user_id,u.email as assigned_email,
 (s.match_id is not null) as has_scouting
 from catalog c left join sessions s on s.match_id=c.match_id and s.kind=c.kind
 left join public.users u on u.id=s.assigned_scouter_user_id
 where ($1='' or c.players::text ilike '%'||$1||'%' or array_to_string(c.player_names,' ') ilike '%'||$1||'%' or c.tournament_name ilike '%'||$1||'%' or exists(select 1 from public.players sp where sp.id=any(c.player_ids) and sp.name ilike '%'||$1||'%'))
 and ($2='' or c.match_status=$2) and ($3='' or c.kind=$3)
 and ($4='' or ($4='scouted' and s.match_id is not null) or ($4='unscouted' and s.match_id is null) or ($4='pending' and s.source='video' and coalesce(s.scout_phase,'')<>'finished'))
 and ($5='' or coalesce(u.email,s.updated_by,'') ilike '%'||$5||'%')
 and ($10='' or ($10='1' and ($11::uuid is not null and (s.assigned_scouter_user_id=$11::uuid or s.creator_user_id=$11::uuid) or (s.source='admin' and s.updated_by=$12 and $12<>''))))
 and ($13::uuid is null or $13::uuid=any(c.player_ids))
 and ($14='' or c.player_ids && $15::uuid[])
 and ($9='' or ($9='premier' and c.league_tier in ('major','p1','p2','finals')) or ($9='fip' and left(c.league_tier,4)='fip_') or c.league_tier=$9)
 and ($6='' or (c.match_date at time zone 'Europe/Madrid')::date::text=$6)
 ), paged as materialized (
 select * from filtered order by case when ($13::uuid is not null or $14='1') then case when match_status='live' then 0 when match_status='scheduled' then 1 else 2 end else 0 end, case when ($13::uuid is not null or $14='1') and match_status='scheduled' then sort_date end asc nulls last, sort_date desc nulls last,match_id desc,kind limit $7 offset $8
 ) select f.*,coalesce(f.players,(select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.name,f.player_names[slot.n],'Player TBC'),'avatar_url',p.avatar_url,'country',p.country,'ranking',p.ranking) order by slot.n) from generate_subscripts(f.player_ids,1) as slot(n) left join public.players p on p.id=f.player_ids[slot.n])) as players,
 (select jsonb_agg(jsonb_build_object('a',st.pair1_games,'b',st.pair2_games) order by st.set_number) from public.sets st where st.match_id=f.match_id and f.kind='match') as official_sets,
 (f.kind='match' and (exists(select 1 from public.match_points mp where mp.match_id=f.match_id) or exists(select 1 from public.games g where g.match_id=f.match_id and cardinality(g.points)>0))) as has_pbp
 from paged f order by case when ($13::uuid is not null or $14='1') then case when match_status='live' then 0 when match_status='scheduled' then 1 else 2 end else 0 end, case when ($13::uuid is not null or $14='1') and match_status='scheduled' then sort_date end asc nulls last, sort_date desc nulls last,match_id desc,kind`

export async function loadMatchCatalog(db:Pick<Pool,'query'>,filters:CatalogFilters,viewer:{id?:string;email?:string|null}={}){
 const {q,status,kind,scouting,scouter,date,page,league,mine,player,watchlist,watched}=filters
 const limited=!!player||watchlist==='1'
 const size=limited?10:MATCH_PAGE_SIZE
 const result=await db.query(CATALOG_SQL,[q,status,kind,scouting,scouter,date,size+1,limited?0:(page-1)*size,league,mine,viewer.id??null,viewer.email??'',player||null,watchlist,watched?watched.split(','):[]])
 const rows=result.rows.slice(0,size),hasNext=!limited&&result.rows.length>size
 const ids=rows.filter(r=>r.has_scouting).map(r=>r.match_id)
 if(ids.length){
  const saved=await db.query(`select match_id,'match' as kind,'video' as source,players,document,revision,score->>'phase' as phase from public.operator_video_scouting_sessions where match_id=any($1::uuid[])
   union all select match_id,'private','video',players,document,revision,score->>'phase' from public.operator_manual_video_scouting_sessions where match_id=any($1::uuid[])
   union all select match_id,'match','admin',players,document,revision,null from public.operator_scouting_sessions a where match_id=any($1::uuid[]) and not exists(select 1 from public.operator_video_scouting_sessions v where v.match_id=a.match_id)`,[ids])
  const byId=new Map(saved.rows.map(r=>[r.kind+':'+r.match_id,r]))
  for(const row of rows){const session=byId.get(row.kind+':'+row.match_id);if(session){
   // Saved roster order must match the scouting timeline; catalog avatars stay attached by ID.
   row.avatars=Object.fromEntries(row.players.filter((p:any)=>p.id).map((p:any)=>[p.id,p.avatar_url]))
   const profiles=new Map(row.players.filter((p:any)=>p.id).map((p:any)=>[p.id,p]))
   const players=session.players.map((p:any)=>{const profile=profiles.get(p.id) as any;return {...p,...(profile?{avatar_url:profile.avatar_url,country:profile.country,ranking:profile.ranking}:{})}})
   Object.assign(row,session,{players})
  }}
 }
 return {rows,hasNext}
}
