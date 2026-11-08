import {pgPool} from '../db'
import {assistantCatalogUrl,type AssistantFilters} from './assistant-filters'
export async function resolveAssistantSearch(filters:AssistantFilters,playerId?:string){
  let player:{id:string;name:string}|undefined
  if(filters.player_name){const client=await pgPool().connect();let candidates:Array<{id:string;name:string}>;try{await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='8s'");const term=filters.player_name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();candidates=(await client.query(`select id,name from public.players where strpos(lower(normalized_name),$1)>0 or strpos(lower(name),lower($2))>0 order by case when lower(normalized_name)=$1 or lower(name)=lower($2) then 0 else 1 end,name limit 21`,[term,filters.player_name])).rows;await client.query('COMMIT')}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
   const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const exact=candidates.filter(p=>normalize(p.name)===normalize(filters.player_name!));if(exact.length===1)candidates=exact
   player=playerId?candidates.find(p=>p.id===playerId):candidates.length===1?candidates[0]:undefined
   if(!player)return ({kind:'clarify',filters,candidates:candidates.slice(0,20),reply:candidates.length?'Which player did you mean? Choose below or use the full name.':'No matching player was found in your database. Try a full name.'})
  }
  return ({kind:'search',url:assistantCatalogUrl(filters,player),reply:`Applied your filters to the match library${player?' for '+player.name:''}${filters.outcome==='all'?'':' · '+filters.outcome}${filters.start_date||filters.end_date?' · '+(filters.start_date||'earliest')+' to '+(filters.end_date||'latest'):''}. Results use your database; use Next to browse every matching page.`})
}
