/** Capture with scripts/fetch-world-cup-history.py; dry-run unless --apply. */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { parseHistoricalPodiums,parseHistoricalSquads,parseHistoricalMatches,parseHistoricalGroups,parseHistoricalTies,parseHistoricalMedia,type ArchiveRecord } from '../padelgod/src/parsers/world-cup-history.js';
const dir=process.argv.find(a=>a.startsWith('--source-dir='))?.split('=')[1];
if(!dir)throw new Error('Required: --source-dir=/path/to/captured/archive');
const manifest: {key:string;url:string;path:string;ok:boolean}[]=JSON.parse(readFileSync(`${dir}/manifest.json`,'utf8'));
if(manifest.some(s=>!s.ok))throw new Error('Source capture failed; refusing partial import');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const sources=manifest.map(s=>{const raw_html=readFileSync(s.path,'utf8');return {...s,raw_html,content_sha256:hash(raw_html),id:hash(s.url+'\n'+hash(raw_html)),fetched_at:statSync(s.path).mtime.toISOString()};});
const source=(key:string)=>{const s=sources.find(s=>s.key===key);if(!s)throw new Error(`Missing source ${key}`);return s;};
const records:(ArchiveRecord & {source_id:string})[]=[];
const add=(rows:ArchiveRecord[],key:string)=>records.push(...rows.map(r=>({...r,source_id:source(key).id})));
add(parseHistoricalPodiums(source('honours').raw_html),'honours');
if(records.length!==34)throw new Error(`Expected 34 national-team podium rows, got ${records.length}`);
add(parseHistoricalSquads(source('roster2024').raw_html,2024),'roster2024');
add(parseHistoricalGroups(source('groups2024').raw_html,2024),'groups2024');
add(parseHistoricalMedia(source('event2024').raw_html,2024),'event2024');
for(let day=1;day<=6;day++){
 const oop=`oop2024-${day}`, result=`results2024-${day}`;
 const matches=parseHistoricalMatches(source(oop).raw_html,source(result).raw_html,2024,day);
 for(const m of matches)m.payload.resultSourceId=source(result).id;
 add(matches,oop);add(parseHistoricalTies(source(`ties2024-${day}`).raw_html,2024,day),`ties2024-${day}`);
}
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_KEY!,{auth:{persistSession:false}});
const profiles:{id:string;name:string;display_name:string|null;category:string|null}[]=[];
for(let offset=0;;offset+=1000){const {data,error}=await db.from('players').select('id,name,display_name,category').order('id').range(offset,offset+999);if(error)throw error;profiles.push(...data!);if(data!.length<1000)break;}
const key=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z ]/g,'').replace(/\s+/g,' ').trim();
let linked=0,unlinked=0;
for(const row of records.filter(r=>r.kind==='squad')){
 row.payload.players=(row.payload.players as string[]).map(name=>{
  const found=profiles.filter(p=>p.category===row.category&&[p.name,p.display_name].some(n=>n&&key(n)===key(name)));
  const playerId=found.length===1?found[0]!.id:null;if(playerId)linked++;else unlinked++;
  return {name,playerId,linkStatus:found.length>1?'ambiguous':playerId?'exact-name':'unresolved'};
 });
}
// Link match slots through the edition's squad, never today's national team.
const { normalizeCountry } = await import('../padelgod/src/lib/country.js');
for(const row of records.filter(r=>r.kind==='match')){
 row.payload.players=['team1Player1','team1Player2','team2Player1','team2Player2'].map(slot=>{
  const rawName=row.payload[`${slot}Name`] as string|null;
  const country=row.payload[`${slot}Country`] as string|null;
  const squad=records.find(s=>s.kind==='squad'&&s.edition_year===row.edition_year&&s.category===row.category&&s.external_id===normalizeCountry(country));
  const tokens=key(rawName??'').split(' ');
  const candidates=((squad?.payload.players??[]) as {name:string;playerId:string|null}[]).filter(p=>key(p.name)===key(rawName??'')||(tokens[0]?.length===1&&key(p.name).startsWith(tokens[0])&&key(p.name).endsWith(` ${tokens.slice(1).join(' ')}`)));
  return {slot,rawName,country,rosterName:candidates.length===1?candidates[0]!.name:null,playerId:candidates.length===1?candidates[0]!.playerId:null};
 });
}
const unique=new Map<string,typeof records[number]>();
for(const row of records){const id=[row.edition_year,row.kind,row.category,row.external_id].join('|');const old=unique.get(id);if(old&&JSON.stringify(old.payload)!==JSON.stringify(row.payload))throw new Error(`Conflicting records: ${id}`);unique.set(id,row);}
const rows=[...unique.values()];
const years=[...new Set(rows.map(r=>r.edition_year))].sort((a,b)=>a-b);
const editions=years.map(year=>({year,name:`World Padel Championships ${year}`,coverage:{
 level:year===2024?'detailed-archive':'podium-only',
 counts:Object.fromEntries([...new Set(rows.filter(r=>r.edition_year===year).map(r=>r.kind))].map(kind=>[kind,rows.filter(r=>r.edition_year===year&&r.kind===kind).length])),
 gaps:year===2024?['PDF documents retained as references, not transcribed','Player links use unique exact names only; unresolved identities remain visible','Team-results archive is partial; not all ties are available','Unplayed or unavailable rubber results remain null','Archive completeness requires editorial review']:['Match results, team ties and rosters not yet verified/imported'],
}}));
const summary={editions:editions.length,sources:sources.length,records:rows.length,counts:Object.fromEntries([...new Set(rows.map(r=>r.kind))].map(kind=>[kind,rows.filter(r=>r.kind===kind).length])),rosterLinks:{linked,unlinked},matchesWithoutResults:rows.filter(r=>r.kind==='match'&&!r.payload.result).length};
if(summary.counts.squad!==32 || summary.counts.match!<100)throw new Error('2024 archive unexpectedly incomplete');
writeFileSync(`${dir}/preview.json`,JSON.stringify({summary,editions,records:rows},null,2));
console.log(JSON.stringify(summary,null,2));
if(process.argv.includes('--apply')){
 const url=new URL(process.env.DATABASE_URL!);
 const client=new pg.Client({host:url.hostname,port:Number(url.port||5432),database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
 await client.connect();
 try {
  await client.query('BEGIN');
  await client.query(`insert into public.world_cup_archive_editions(year,name,coverage)
    select year,name,coverage from jsonb_to_recordset($1::jsonb) as x(year integer,name text,coverage jsonb)
    on conflict(year) do update set name=excluded.name,coverage=excluded.coverage,imported_at=now()`,[JSON.stringify(editions)]);
  await client.query(`insert into public.world_cup_archive_sources(id,url,content_sha256,raw_html,fetched_at)
    select id,url,content_sha256,raw_html,fetched_at from jsonb_to_recordset($1::jsonb) as x(id text,url text,content_sha256 text,raw_html text,fetched_at timestamptz)
    on conflict(id) do nothing`,[JSON.stringify(sources)]);
  await client.query(`insert into public.world_cup_archive_records(edition_year,kind,category,external_id,payload,source_id)
    select edition_year,kind,category,external_id,payload,source_id from jsonb_to_recordset($1::jsonb) as x(edition_year integer,kind text,category text,external_id text,payload jsonb,source_id text)
    on conflict(edition_year,kind,category,external_id) do update set payload=excluded.payload,source_id=excluded.source_id,imported_at=now()`,[JSON.stringify(rows)]);
  await client.query('COMMIT');console.log('Archive imported transactionally. Live matches and player profiles unchanged.');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}
