import {parse,toSql} from 'pgsql-ast-parser'
import {pgPool} from '../db'
const tables=new Set(['assistant_matches','assistant_players','assistant_tournaments','assistant_sets'])
const types=new Set(['select','table','ref','integer','numeric','string','null','boolean','call','binary','unary','case','cast','list','INNER JOIN','LEFT JOIN','RIGHT JOIN','FULL JOIN','CROSS JOIN'])
const functions=new Set(['count','sum','avg','min','max','round','abs','coalesce','nullif','lower','upper','length','trim','date_part','date_trunc'])
const operators=new Set(['+','-','*','/','%','=','!=','<>','>','<','>=','<=','AND','OR','LIKE','NOT LIKE','ILIKE','NOT ILIKE','IN','NOT IN','NOT','IS NULL','IS NOT NULL','IS TRUE','IS FALSE','IS NOT TRUE','IS NOT FALSE'])
export function validateAssistantSql(sql:string){
 if(typeof sql!=='string'||sql.length>6000)throw Error('Use a SELECT query under 6,000 characters.')
 let ast;try{ast=parse(sql)}catch{throw Error('Unsupported SQL syntax. Use a simple PostgreSQL SELECT.')}
 if(ast.length!==1||ast[0].type!=='select')throw Error('Only one SELECT statement is allowed; no custom CTEs or writes.')
 let nodes=0
 function visit(value:unknown,depth=0){
  if(++nodes>1000||depth>35)throw Error('Query is too complex.')
  if(!value||typeof value!=='object')return
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return}
  const n=value as Record<string,any>
  if('schema' in n)throw Error('Schema-qualified names are not allowed. Use the approved assistant tables.')
  if(n.type&&!types.has(n.type))throw Error('This SQL operation is not supported.')
  if(n.type==='select'&&Object.keys(n).some(k=>!['type','columns','from','where','groupBy','having','orderBy','limit','distinct'].includes(k)))throw Error('Only read-only SELECT clauses are allowed.')
  if(n.type==='table'&&(!tables.has(n.name?.name)||Object.keys(n).some(k=>!['type','name','join'].includes(k))))throw Error('Only approved assistant tables may be queried.')
  if(n.type==='call'&&(!functions.has(n.function?.name?.toLowerCase())||n.over))throw Error('This SQL function is not allowed.')
  if((n.type==='binary'||n.type==='unary')&&!operators.has(n.op))throw Error('This SQL operator is not allowed.')
  if(n.type==='cast'&&(!['integer','int','bigint','numeric','decimal','float','double precision','text','date','timestamp','timestamptz','boolean'].includes(n.to?.name)||n.to?.arrayOf||n.to?.config))throw Error('This cast is not allowed.')
  for(const child of Object.values(n))visit(child,depth+1)
 }
 visit(ast[0]);return toSql.statement(ast[0])
}
// These query-local projections are the ONLY relations the model can name.
// No persistent views, grants, role changes, or production writes are needed.
export const ASSISTANT_VIEWS=`WITH assistant_matches AS MATERIALIZED (
 SELECT m.id AS match_id,m.tournament_id,m.status,m.round,m.category,
 (m.scheduled_at AT TIME ZONE 'Europe/Madrid')::date AS match_date,
 m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id,m.winner_pair,
 CASE WHEN m.duration ~ '^[0-9]{1,2}:[0-5][0-9]$' THEN split_part(m.duration,':',1)::int*60+split_part(m.duration,':',2)::int ELSE NULL END AS duration_minutes,
 (SELECT count(*)::int FROM public.sets s WHERE s.match_id=m.id AND s.pair1_games IS NOT NULL AND s.pair2_games IS NOT NULL) AS recorded_sets,
 (EXISTS(SELECT 1 FROM public.operator_video_scouting_sessions s WHERE s.match_id=m.id) OR EXISTS(SELECT 1 FROM public.operator_scouting_sessions s WHERE s.match_id=m.id)) AS has_scouting
 FROM public.matches m
), assistant_players AS MATERIALIZED (SELECT id AS player_id,name,normalized_name,country FROM public.players),
 assistant_tournaments AS MATERIALIZED (SELECT id AS tournament_id,name,level FROM public.tournaments),
 assistant_sets AS MATERIALIZED (SELECT match_id,set_number,pair1_games,pair2_games FROM public.sets)
`
export async function queryAssistantData(sql:string){
 const safe=validateAssistantSql(sql),client=await pgPool().connect()
 try{await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='6s'");await client.query("SET LOCAL lock_timeout='1s'");await client.query("SET LOCAL search_path=pg_catalog");await client.query("SET LOCAL work_mem='4MB'");
  const result=await client.query(`${ASSISTANT_VIEWS} SELECT * FROM (${safe}) AS assistant_result LIMIT 51`)
  const truncated=result.rows.length>50;const rows=result.rows.slice(0,50);if(JSON.stringify(rows).length>24000)throw Error('Result is too large. Select fewer columns or aggregate the results.')
  await client.query('COMMIT');return {rows,truncated,limit:50}
 }catch(e){await client.query('ROLLBACK').catch(()=>{});if((e as {code?:string}).code==='57014')throw Error('Query exceeded its six-second limit. Simplify it.');throw e}finally{client.release()}
}
export const assistantSchema=`You can query ONLY these PostgreSQL query-local tables:
assistant_matches(match_id uuid,tournament_id uuid,status text,round text,category text,match_date date in Europe/Madrid,pair1_player1_id uuid,pair1_player2_id uuid,pair2_player1_id uuid,pair2_player2_id uuid,winner_pair integer 1/2/null,duration_minutes integer/null,recorded_sets integer,has_scouting boolean).
assistant_players(player_id uuid,name text,normalized_name text,country text).
assistant_tournaments(tournament_id uuid,name text,level text).
assistant_sets(match_id uuid,set_number integer,pair1_games integer,pair2_games integer).
Only one SELECT, joins, subqueries, CASE, GROUP BY, ORDER BY, LIMIT. No schema qualification, custom WITH, writes, UNION, or window functions. Allowed functions: ${[...functions].join(', ')}. Use casts like ::numeric for percentages. Result limit 50 rows. For complete counts use COUNT, never count returned limited rows. Dates are dates: compare >= '2026-01-01' and <= '2026-12-31'. Match name/round/category data can vary in capitalization. Resolve names via assistant_players before querying matches; never invent IDs. Use IN(player slots) to locate a player. Win/loss requires known winner_pair and finished status. recorded_sets includes recorded sets, not guaranteed complete data. has_scouting is session existence only, not completion or report contents. Durations parse stored HH:MM; NULL means unavailable. Never treat missing duration as zero. Exclude <=0 durations, inspect obvious anomalies, and disclose duration coverage with COUNT(duration_minutes) vs COUNT(*) for the same scope. Default finished matches unless user asks otherwise. Data coverage may be incomplete.`
