// Local PostgreSQL/WASM only. Input is a read-only export of public PPL rows.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { renderPplRepair } from './render-ppl-repair.mjs';
const seed=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const db=new PGlite();
const extra={tournaments:['location','country','last_updated_by'],team_seasons:['ties_played','ties_won','courts_won','courts_lost'],matches:['started_at'],sets:['score_source','is_current'],team_memberships:['games_played','wins','losses']};
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const type=(key,values)=>{
 if(key==='id'||['team_id','team_season_id','player_id','match_id','tournament_id','tie_id','home_team_season_id','away_team_season_id','pair1_player1_id','pair1_player2_id','pair2_player1_id','pair2_player2_id'].includes(key))return 'uuid';
 const sample=values.find(v=>v!==null&&v!==undefined);
 if(typeof sample==='boolean'||key==='is_current')return 'boolean';
 if(typeof sample==='number')return values.some(v=>typeof v==='number'&&!Number.isInteger(v))?'double precision':'integer';
 if(['ties_played','ties_won','courts_won','courts_lost','games_played','wins','losses','session_number'].includes(key))return 'integer';
 if(typeof sample==='object')return 'jsonb';
 return 'text';
};
try{
 for(const [table,rows] of Object.entries(seed)){
  const keys=[...new Set(['id',...rows.flatMap(Object.keys),...(extra[table]??[])])];
  await db.exec(`create table ${quote(table)}(${keys.map(k=>quote(k)+' '+type(k,rows.map(r=>r[k]))+(k==='id'?' primary key default gen_random_uuid()':'')).join(',')})`);
  for(const row of rows){const ks=Object.keys(row);await db.query(`insert into ${quote(table)}(${ks.map(quote)}) values(${ks.map((_,i)=>'$'+(i+1))})`,ks.map(k=>typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k]):row[k]));}
 }
 await db.exec('create unique index set_match_number on sets(match_id,set_number); create unique index membership_identity on team_memberships(team_season_id,player_id); create unique index tie_identity on league_ties(tournament_id,tie_key);');
 const all=async()=>{const out={};for(const t of Object.keys(seed))out[t]=(await db.query(`select * from ${quote(t)} order by id`)).rows;return out;};
 const before=await all();
 const sql=renderPplRepair();await db.exec(sql);const after=await all();
 const playa=after.tournaments.find(t=>t.external_id==='playa-del-carmen');
 const vegas=after.tournaments.find(t=>t.external_id==='mgm-pro-padel-league-las-vegas-2026');
 const pm=after.matches.filter(m=>m.tournament_id===playa.id),vm=after.matches.filter(m=>m.tournament_id===vegas.id);
 assert.equal(pm.length,24);assert.ok(pm.every(m=>m.status==='finished'&&m.finished_at&&[1,2].includes(m.winner_pair)));
 assert.ok(pm.every(m=>[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id].every(Boolean)));
 assert.equal(vm.length,20);
 const vegasFinals=vm.filter(m=>m.status==='finished');
 assert.equal(vegasFinals.length,4);
 assert.equal(vm.filter(m=>m.status==='scheduled'&&!m.winner_pair).length,16);
 assert.ok(vegasFinals.every(m=>m.finished_at&&[1,2].includes(m.winner_pair)&&[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id].every(Boolean)));
 assert.ok(after.sets.some(s=>vegasFinals.some(m=>m.id===s.match_id)&&s.pair1_games===10&&s.pair2_games===6));
 assert.equal(vm.map(m=>m.scheduled_at).sort()[0],'2026-11-19 01:00:00+00');
 assert.deepEqual(after.league_standings,before.league_standings);
 assert.deepEqual(after.players,before.players);assert.deepEqual(after.teams,before.teams);
 assert.deepEqual(after.matches.filter(m=>m.tournament_id!==playa.id&&m.tournament_id!==vegas.id),before.matches.filter(m=>m.tournament_id!==playa.id));
 for(const m of before.matches.filter(m=>m.tournament_id===playa.id))assert.ok(pm.some(x=>x.id===m.id));
 await db.exec(sql);assert.deepEqual(await all(),after,'Second run must have identical data');
 // A conflict late in the repair must roll back earlier event/result writes.
 const bad=sql.replace('"playerIds":[','"playerIds":["00000000-0000-0000-0000-000000000000",');
 await assert.rejects(db.exec(bad),/Player identity conflict/);await db.exec('rollback');
 assert.deepEqual(await all(),after,'Failed transaction must leave all rows unchanged');
 if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(after,null,2));
 const upcoming=vm.find(m=>m.status==='scheduled');
 await db.query("update matches set status='live' where id=$1",[upcoming.id]);
 await db.exec(sql);
 assert.equal((await db.query('select status from matches where id=$1',[upcoming.id])).rows[0].status,'live','Static repair must not reset an active match');
 console.log('PASS: 24 Playa finals + 4 Vegas finals, 16 scheduled, 20 existing IDs retained; player history, unchanged other events/ranking/players, idempotence, atomic rollback.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await db.close();}
