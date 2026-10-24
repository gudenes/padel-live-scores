import 'server-only'
import {pgPool} from '@/lib/db'
import {convertSession,type Person,type Match,type SessionRow} from './model'
export type HistoryMatch={countries?:(string|null)[];duration?:string|null;court?:string|null;id:string;manual:boolean;date:string|null;tournament:string;tournamentId:string|null;level:string|null;round:string|null;status:string;winner:number|null;playerIds:(string|null)[];names:string[];score:string;scouted:boolean}
let cache:{until:number;value:Promise<{people:Person[];matches:Match[];history:HistoryMatch[];excluded:number}>}|undefined
export function intelligenceData(){
 if(cache&&cache.until>Date.now())return cache.value
 const value=load().catch(e=>{cache=undefined;throw e});cache={until:Date.now()+300000,value};return value
}
async function load(){
 const db=pgPool()
 const people=(await db.query(`select id,coalesce(nullif(display_name,''),name) as name,country,ranking,avatar_url,category,hand,side,height,birthplace,birthdate::text,profile_url from players order by ranking nulls last,name,id`)).rows as Person[]
 const rows=(await db.query(`select v.match_id,v.document,v.players,v.revision,v.updated_at,'video' as source,false as manual,m.scheduled_at::text as date,t.name as tournament,m.round,null::jsonb as roster from operator_video_scouting_sessions v join matches m on m.id=v.match_id left join tournaments t on t.id=m.tournament_id
 union all select v.match_id,v.document,v.players,v.revision,v.updated_at,'video',true,m.match_date::text,m.tournament_label,null,m.players from operator_manual_video_scouting_sessions v join operator_manual_scouting_matches m on m.id=v.match_id
 union all select v.match_id,v.document,v.players,v.revision,v.updated_at,'admin',false,m.scheduled_at::text,t.name,m.round,null from operator_scouting_sessions v join matches m on m.id=v.match_id left join tournaments t on t.id=m.tournament_id where not exists(select 1 from operator_video_scouting_sessions x where x.match_id=v.match_id)`)).rows as SessionRow[]
 const map=new Map(people.map(p=>[p.id,p])),matches:Match[]=[];let excluded=0
 for(const row of rows){try{const m=convertSession(row,map);if(m){matches.push(m);for(const p of m.players)if(!map.has(p.id)){map.set(p.id,p);people.push(p)}}}catch{excluded++}}
 const history=(await db.query(`select m.id,false as manual,m.scheduled_at::text as date,coalesce(t.name,'Tournament match') as tournament,m.tournament_id as "tournamentId",t.level,m.round,m.status,m.duration,m.court,m.winner_pair as winner,
 array[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id] as "playerIds",
 array[m.pair1_player1_name,m.pair1_player2_name,m.pair2_player1_name,m.pair2_player2_name] as names,
 coalesce((select string_agg(s.pair1_games::text||'–'||s.pair2_games::text,'  ' order by s.set_number) from sets s where s.match_id=m.id and s.pair1_games is not null and s.pair2_games is not null),'') as score
 from matches m left join tournaments t on t.id=m.tournament_id`)).rows as HistoryMatch[]
 const scouted=new Map(matches.map(m=>[m.id,m]))
 for(const m of history){m.countries=m.playerIds.map(id=>map.get(id??'')?.country??null);m.scouted=scouted.has(m.id);m.names=m.playerIds.map((id,i)=>map.get(id??'')?.name||m.names[i]||'Player to be confirmed')}
 const manual=(await db.query(`select id,match_date::text as date,tournament_label as tournament,players from operator_manual_scouting_matches`)).rows
 for(const row of manual){const m=scouted.get(row.id),roster=row.players as Array<{id:string;existingPlayerId?:string;name:string}>;history.push({id:row.id,manual:true,date:row.date,tournament:row.tournament||'Private match',tournamentId:null,level:null,round:null,status:m?.winner?'finished':m?'in progress':'',playerIds:roster.map(p=>p.existingPlayerId??p.id),names:roster.map(p=>map.get(p.existingPlayerId??p.id)?.name??p.name),winner:m?.winner==='a'?1:m?.winner==='b'?2:null,score:m?.score??'',scouted:!!m})}

 history.sort((a,b)=>(b.date??'').localeCompare(a.date??''))
 matches.sort((a,b)=>(b.date??'').localeCompare(a.date??''));return {people,matches,history,excluded}
}
