import {catalogFilters,catalogUrl,type CatalogFilters} from './match-catalog'
export const rounds=['all','final','semifinal','quarterfinal','round_of_16','round_of_32','round_of_64'] as const
export type AssistantFilters={player_name:string|null;outcome:'all'|'won'|'lost';start_date:string|null;end_date:string|null;round:typeof rounds[number];scouting:'all'|'with'|'without';tournament:string|null}
export const emptyAssistantFilters:AssistantFilters={player_name:null,outcome:'all',start_date:null,end_date:null,round:'all',scouting:'all',tournament:null}
export function validDate(s:unknown):s is string{return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s}
export function parseAssistantFilters(input:unknown):AssistantFilters{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid match filters.')
 const f=input as Record<string,unknown>
 if(Object.keys(f).sort().join()!==Object.keys(emptyAssistantFilters).sort().join())throw Error('Invalid match filters.')
 for(const key of ['player_name','tournament'])if(f[key]!==null&&(typeof f[key]!=='string'||!(f[key] as string).trim()||(f[key] as string).length>120))throw Error('Invalid match filters.')
 if(!['all','won','lost'].includes(String(f.outcome))||!rounds.includes(f.round as typeof rounds[number])||!['all','with','without'].includes(String(f.scouting)))throw Error('Invalid match filters.')
 for(const key of ['start_date','end_date'])if(f[key]!==null&&!validDate(f[key]))throw Error('Invalid match date.')
 if(f.start_date&&f.end_date&&String(f.start_date)>String(f.end_date))throw Error('Start date must precede end date.')
 return f as AssistantFilters
}
export function assistantContext(f:CatalogFilters):AssistantFilters{return {player_name:f.playerName||null,outcome:f.outcome||'all',start_date:f.from||null,end_date:f.to||null,round:(f.round||'all') as AssistantFilters['round'],scouting:f.scouting==='scouted'?'with':f.scouting==='unscouted'?'without':'all',tournament:f.tournamentQuery||null}}
export function assistantCatalogUrl(f:AssistantFilters,player?:{id:string;name:string}){
 if(f.player_name&&!player)throw Error('Choose a player first.')
 if(f.outcome!=='all'&&!player)throw Error('Choose a player for wins or losses.')
 return catalogUrl(catalogFilters({assistant:'1',player:player?.id,playerName:player?.name,outcome:f.outcome==='all'?'':f.outcome,from:f.start_date||'',to:f.end_date||'',round:f.round==='all'?'':f.round,scouting:f.scouting==='all'?'':f.scouting==='with'?'scouted':'unscouted',tournamentQuery:f.tournament||'',status:'finished',kind:'match',league:'',date:''}))
}
