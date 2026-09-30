// Isolated PostgreSQL integration test. All DDL/data are rolled back.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
process.loadEnvFile('.env.local')
const db=new pg.Client({connectionString:process.env.DATABASE_URL})
await db.connect()
const schema=`editorial_test_${Date.now()}`
let checks=0
async function expectError(sql, args, pattern){await db.query('SAVEPOINT failure');try{await db.query(sql,args);assert.fail('Expected SQL rejection')}catch(e){assert.match(e.message,pattern);checks++}finally{await db.query('ROLLBACK TO SAVEPOINT failure')}}
try {
 await db.query('BEGIN')
 await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path=${schema},public;
 CREATE TABLE ${schema}.matches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid,status text,scheduled_at timestamptz);
 CREATE TABLE ${schema}.tournaments(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
 CREATE TABLE ${schema}.market_templates(LIKE public.market_templates INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
 CREATE TABLE ${schema}.market_seasons(LIKE public.market_seasons INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
 CREATE TABLE ${schema}.market_limits(LIKE public.market_limits INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
 CREATE TABLE ${schema}.markets(LIKE public.markets INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
 ALTER TABLE ${schema}.markets DROP CONSTRAINT IF EXISTS markets_one_scope;
 ALTER TABLE ${schema}.markets DROP COLUMN IF EXISTS editorial_scope;
 ALTER TABLE ${schema}.markets DROP COLUMN IF EXISTS question_snapshot;
 ALTER TABLE ${schema}.markets DROP COLUMN IF EXISTS rules_snapshot;
 ALTER TABLE ${schema}.markets DROP COLUMN IF EXISTS bound_match_id;
 ALTER TABLE ${schema}.markets DROP CONSTRAINT IF EXISTS markets_check;
 ALTER TABLE ${schema}.markets ADD CONSTRAINT markets_check CHECK ((match_id IS NULL) <> (tournament_id IS NULL));
 ALTER TABLE ${schema}.markets ADD PRIMARY KEY(id);`)
 for(const file of ['20260929170000_play_editorial_scopes.sql','20260929190000_play_editorial_publishing.sql']){
   const sql=(await readFile(`supabase/migrations/${file}`,'utf8')).replace(/^BEGIN;|^COMMIT;/gm,'').replace(/\bpublic\b/g,schema)
   await db.query(sql)
 }
 const season=(await db.query("INSERT INTO market_seasons(name,starts_at,ends_at,status) VALUES('Test',now()-interval '1 day',now()+interval '90 days','active') RETURNING id")).rows[0].id
 await db.query('INSERT INTO market_limits DEFAULT VALUES')
 const now=Date.now(), later=n=>new Date(now+n*86400000).toISOString()
 const preview={errors:[],fingerprint:'reviewed',templateKey:'editorial.ranking.v1',seasonId:season,category:'men',tournamentId:null,editorialScope:'test-window',boundMatchId:null,
 resolverKey:'player.reaches_ranking_v1',params:{playerId:'11111111-1111-1111-1111-111111111111',rank:12,startsAt:later(2),endsAt:later(30),voidAfter:later(38)},tokens:{},probability:.4,seedSource:'fixed',maxLoss:1000,locksAt:later(1),question:{en:'Frozen question'},rules:{en:'Frozen rules'}}
 async function draft(v=preview){const d=(await db.query('select play_save_editorial_draft(null,0,$1,$2) d',[{family:'ranking'},'test'])).rows[0].d;return (await db.query('select play_preview_editorial_draft($1,$2,$3,$4) d',[d.id,d.revision,v,'test'])).rows[0].d}
 const d=await draft()
 const args=[d.id,d.revision,d.preview_token,'reviewed','test']
 const pub='select play_publish_editorial_draft($1,$2,$3,$4,$5) id'
 const id=(await db.query(pub,args)).rows[0].id
 assert.equal((await db.query(pub,args)).rows[0].id,id);checks++
 assert.equal((await db.query('select question_snapshot from markets where id=$1',[id])).rows[0].question_snapshot.en,'Frozen question');checks++
 await expectError('update markets set question_snapshot=$1 where id=$2',[{en:'Changed'},id],/frozen/)
 const dup=await draft();await expectError(pub,[dup.id,dup.revision,dup.preview_token,'reviewed','test'],/duplicate_market/)
 const stale=await draft({...preview,editorialScope:'other'});await db.query('select play_save_editorial_draft($1,$2,$3,$4)',[stale.id,stale.revision,{family:'ranking'},'test']);await expectError(pub,[stale.id,stale.revision,stale.preview_token,'reviewed','test'],/preview_expired_or_changed/)
 const exp=await draft({...preview,editorialScope:'expired'});await db.query("update market_editorial_drafts set preview_expires_at=now()-interval '1 second' where id=$1",[exp.id]);await expectError(pub,[exp.id,exp.revision,exp.preview_token,'reviewed','test'],/preview_expired_or_changed/)
 const blocked=await draft({...preview,errors:['Missing evidence'],editorialScope:'blocked'});await expectError(pub,[blocked.id,blocked.revision,blocked.preview_token,'reviewed','test'],/preview_not_ready/)
 await db.query('update market_limits set max_open_markets=1');const cap=await draft({...preview,editorialScope:'cap'});await expectError(pub,[cap.id,cap.revision,cap.preview_token,'reviewed','test'],/open_market_limit/);await db.query('update market_limits set max_open_markets=15')
 const tournament=(await db.query('insert into tournaments default values returning id')).rows[0].id
 const match=(await db.query("insert into matches(tournament_id,status,scheduled_at) values($1,'scheduled',$2) returning id",[tournament,later(1)])).rows[0].id
 const bound=await draft({...preview,templateKey:'editorial.round.v1',resolverKey:'tournament.pair_reaches_round_v1',params:{player1Id:'a',player2Id:'b',round:'SF'},tournamentId:tournament,editorialScope:null,boundMatchId:match})
 const boundId=(await db.query(pub,[bound.id,bound.revision,bound.preview_token,'reviewed','test'])).rows[0].id
 await db.query("update matches set status='live' where id=$1",[match]);assert.equal((await db.query('select status from markets where id=$1',[boundId])).rows[0].status,'locked');checks++
 const changed=await draft({...preview,editorialScope:'changed'});await expectError(pub,[changed.id,changed.revision,changed.preview_token,'different','test'],/preview_expired_or_changed/)
 assert.equal((await db.query("select count(*)::int n from market_editorial_audit where action='published'")).rows[0].n,2);checks++
 // Make only this isolated schema visible to a second connection for a real lock race.
 await db.query('COMMIT'); await db.query(`SET search_path=${schema},public`)
 await db.query('update market_limits set max_open_markets=2')
 const a=await draft({...preview,editorialScope:'concurrent-a'}), b=await draft({...preview,editorialScope:'concurrent-b'})
 const second=new pg.Client({connectionString:process.env.DATABASE_URL});await second.connect()
 try {
  await second.query(`SET search_path=${schema},public; SET statement_timeout='10s'`)
  await db.query('BEGIN');await db.query(pub,[a.id,a.revision,a.preview_token,'reviewed','test'])
  const competing=second.query(pub,[b.id,b.revision,b.preview_token,'reviewed','test']).then(()=>null,e=>e)
  await db.query('COMMIT')
  assert.match((await competing)?.message??'',/open_market_limit/);checks++
  assert.equal((await db.query("select count(*)::int n from markets where status='open'")).rows[0].n,2);checks++
 }finally{await second.end()}
 console.log(`Passed ${checks} isolated PostgreSQL assertions, including concurrent publishing; scratch schema removed.`)
} finally {await db.query('ROLLBACK');await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end()}
