// Isolated PostgreSQL tests. No shared database or push providers are contacted.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const [user,other,match,market]=[1,2,3,4].map(id)
async function setup(){
 const db=new PGlite()
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE profiles(id uuid primary key);CREATE TABLE matches(id uuid primary key);
 CREATE TABLE feature_flags(key text,enabled boolean);CREATE TABLE play_access(user_id uuid);
 CREATE TABLE markets(id uuid primary key,match_id uuid);
 CREATE TABLE market_positions(user_id uuid,market_id uuid,yes_shares numeric,no_shares numeric);
 CREATE TABLE play_result_notices(id bigint generated always as identity,user_id uuid,market_id uuid);
 INSERT INTO profiles VALUES('${user}'),('${other}');INSERT INTO matches VALUES('${match}');
 INSERT INTO markets VALUES('${market}','${match}');INSERT INTO feature_flags VALUES('play_enabled',true);
 INSERT INTO play_access VALUES('${user}');
 INSERT INTO market_positions VALUES('${user}','${market}',10,0),('${other}','${market}',10,0);`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261005120000_play_result_push_queue.sql',import.meta.url),'utf8'))
 return db
}
test('queue is whitelist gated, aggregates match events, and does not backfill',async()=>{
 const db=await setup()
 try{
  assert.equal((await db.query('SELECT * FROM play_result_push_queue')).rows.length,0)
  assert.equal((await db.query(`SELECT play_queue_match_push('${other}','${match}') AS ok`)).rows[0].ok,false)
  await db.exec(`INSERT INTO play_result_notices(user_id,market_id) VALUES('${user}','${market}'),('${user}','${market}');`)
  let rows=(await db.query('SELECT * FROM play_result_push_queue')).rows
  assert.equal(rows.length,1);assert.equal(rows[0].generation,2)
  await db.exec(`SELECT play_queue_match_push('${user}','${match}');`)
  assert.equal((await db.query('SELECT generation FROM play_result_push_queue')).rows[0].generation,2)
  await db.exec('UPDATE feature_flags SET enabled=false;DELETE FROM play_result_push_queue;')
  assert.equal((await db.query(`SELECT play_queue_match_push('${user}','${match}') AS ok`)).rows[0].ok,false)
 }finally{await db.close()}
})
test('exclusive claims, late results and lease tokens protect against duplicate/lost work',async()=>{
 const db=await setup()
 try{
  await db.exec(`SELECT play_queue_match_push('${user}','${match}');UPDATE play_result_push_queue SET due_at=now()-interval '1 minute';`)
  const job=(await db.query('SELECT * FROM play_claim_result_pushes()')).rows[0]
  assert.ok(job.lease_token)
  assert.equal((await db.query('SELECT * FROM play_claim_result_pushes()')).rows.length,0)
  await db.exec(`SELECT play_queue_match_push('${user}','${match}',true);`)
  await db.exec(`SELECT play_finish_result_push('${user}','${match}','${id(99)}',1,ARRAY[1]::bigint[],true,false);`)
  assert.equal((await db.query('SELECT match_sent FROM play_result_push_queue')).rows[0].match_sent,false)
  await db.exec(`SELECT play_finish_result_push('${user}','${match}','${job.lease_token}',1,ARRAY[1]::bigint[],true,false);`)
  let row=(await db.query('SELECT * FROM play_result_push_queue')).rows[0]
  assert.ok(row.due_at);assert.equal(row.match_sent,true);assert.deepEqual(row.sent_notice_ids,[1]);assert.equal(row.lease_token,null)
  await db.exec(`UPDATE play_result_push_queue SET due_at=now()-interval '1 minute';`)
  const job2=(await db.query('SELECT * FROM play_claim_result_pushes()')).rows[0]
  await db.exec(`SELECT play_finish_result_push('${user}','${match}','${job2.lease_token}',2,ARRAY[2]::bigint[],true,false);`)
  row=(await db.query('SELECT * FROM play_result_push_queue')).rows[0]
  assert.equal(row.due_at,null);assert.deepEqual(row.sent_notice_ids.sort(),[1,2])
 }finally{await db.close()}
})
test('retry retains frozen payload; completion clears it; public roles cannot execute queue functions',async()=>{
 const db=await setup()
 try{
  await db.exec(`SELECT play_queue_match_push('${user}','${match}');UPDATE play_result_push_queue SET due_at=now()-interval '1 minute',dispatch='{"ids":[1]}'::jsonb;`)
  const job=(await db.query('SELECT * FROM play_claim_result_pushes()')).rows[0]
  await db.exec(`SELECT play_finish_result_push('${user}','${match}','${job.lease_token}',1,'{}',false,true);`)
  assert.deepEqual((await db.query('SELECT dispatch FROM play_result_push_queue')).rows[0].dispatch,{ids:[1]})
  const priv=(await db.query(`SELECT has_function_privilege('authenticated','play_claim_result_pushes()','EXECUTE') AS allowed`)).rows[0]
  assert.equal(priv.allowed,false)
 }finally{await db.close()}
})
