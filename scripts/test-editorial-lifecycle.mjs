// Embedded PostgreSQL: draft -> preview -> publish -> buy -> early lock -> payout/refund.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
for (const family of ['round','champion']) for(const predraw of [false,true]) test(`${family} ${predraw?'pre-draw':'bound'} market lifecycle uses existing atomic trades and settlement`,async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid';
 CREATE TABLE users(id uuid primary key); CREATE TABLE profiles(id uuid primary key);
 CREATE TABLE tournaments(id uuid primary key);
 CREATE TABLE matches(id uuid primary key,tournament_id uuid,status text,winner_pair integer,scheduled_at timestamptz,category text DEFAULT 'men',round_canonical text DEFAULT 'R16');
 INSERT INTO users VALUES('${uuid(1)}'); INSERT INTO profiles SELECT * FROM users; INSERT INTO tournaments VALUES('${uuid(2)}');`)
 for(const file of ['20260923120000_play_market_core.sql','20260923120100_play_market_trading.sql','20260923120200_play_market_ledger.sql','20260418_user_notifications.sql','20260927160000_play_atomic_settlement.sql','20260929170000_play_editorial_scopes.sql','20260929190000_play_editorial_publishing.sql','20261004110000_play_champion_editorial.sql','20261005090000_play_predraw_deadlines.sql']){
  await db.exec((await readFile(`supabase/migrations/${file}`,'utf8')).replace("encode(gen_random_bytes(8), 'hex')","gen_random_uuid()::text"))
 }
 await db.exec(`INSERT INTO market_seasons(id,name,starts_at,ends_at,status) VALUES('${uuid(3)}','Test',now()-interval '1 day',now()+interval '90 days','active');
 INSERT INTO matches(id,tournament_id,status,winner_pair,scheduled_at) VALUES('${uuid(4)}','${uuid(2)}','scheduled',null,${predraw?'null':"now()+interval '1 day'"});
 INSERT INTO user_guaca_balance(user_id,season_id,balance) VALUES('${uuid(1)}','${uuid(3)}',1000);`)
 assert.equal((await db.query("select enabled from market_templates where key='editorial.champion.v1'")).rows[0].enabled,false)
 await db.query("update market_templates set enabled=true where key='editorial.champion.v1'")
 const later=new Date(Date.now()+23*3600000).toISOString()
 const preview={errors:[],fingerprint:'reviewed',templateKey:`editorial.${family}.v1`,seasonId:uuid(3),category:'men',tournamentId:uuid(2),editorialScope:null,boundMatchId:predraw?null:uuid(4),resolverKey:family==='champion'?'tournament.pair_champion_v1':'tournament.pair_reaches_round_v1',params:{player1Id:uuid(5),player2Id:uuid(6),round:'SF'},tokens:{},probability:.5,seedSource:'projection',maxLoss:1000,locksAt:later,question:{en:'Will A/B reach the semifinal?'},rules:{en:'Verified participation; refund if unresolved.'}}
 const draft=(await db.query("select play_save_editorial_draft(null,0,'{}','test') d")).rows[0].d
 const reviewed=(await db.query('select play_preview_editorial_draft($1,$2,$3,$4) d',[draft.id,draft.revision,preview,'test'])).rows[0].d
 const market=(await db.query('select play_publish_editorial_draft($1,$2,$3,$4,$5) id',[draft.id,draft.revision,reviewed.preview_token,'reviewed','test'])).rows[0].id
 const row=(await db.query('select * from markets where id=$1',[market])).rows[0]
 const q={side:'yes',direction:'buy',shares:10,cash:-6,price:.5,oldYes:Number(row.q_yes),oldNo:Number(row.q_no),newYes:Number(row.q_yes)+10,newNo:Number(row.q_no),heldYes:0,heldNo:0,oldBasis:0,positionYes:10,positionNo:0,basis:6,pnl:0,positionCount:1}
 await db.query('select play_commit_trade($1,$2,$3)',[market,uuid(1),q])
 assert.equal((await db.query('select balance from user_guaca_balance')).rows[0].balance,994)
 if(predraw){
  await db.query("insert into matches(id,tournament_id,status,category,round_canonical) values($1,$2,'live','women','R16'),($3,$2,'live','men','Q1')",[uuid(20),uuid(2),uuid(21)])
  assert.equal((await db.query('select status from markets where id=$1',[market])).rows[0].status,'open')
  await db.query("update matches set scheduled_at=now()+interval '2 hours' where id=$1",[uuid(4)])
  const shortened=(await db.query('select locks_at from markets where id=$1',[market])).rows[0].locks_at
  await db.query("update matches set scheduled_at=now()+interval '3 hours' where id=$1",[uuid(4)])
  assert.equal(String((await db.query('select locks_at from markets where id=$1',[market])).rows[0].locks_at),String(shortened))
  // A newly inserted main-draw match must lock it too, not only updates.
  await db.query("insert into matches(id,tournament_id,status,category,round_canonical) values($1,$2,'on_court','men','R32')",[uuid(22),uuid(2)])
 }
 await db.query("update matches set status='live' where id=$1",[uuid(4)])
 assert.equal((await db.query('select status from markets where id=$1',[market])).rows[0].status,'locked')
 await assert.rejects(db.query('select play_commit_trade($1,$2,$3)',[market,uuid(1),q]),/market_not_open/)
 await db.query("select play_settle_market($1,'yes','Confirmed SF','test',0)",[market])
 assert.equal((await db.query('select balance from user_guaca_balance')).rows[0].balance,1004)
 await db.query("select play_settle_market($1,'yes','Retry','test',1)",[market])
 assert.equal((await db.query('select balance from user_guaca_balance')).rows[0].balance,1004)
 await db.query("select play_settle_market($1,'void','Official evidence withdrawn','test',1)",[market])
 assert.equal((await db.query('select balance from user_guaca_balance')).rows[0].balance,1000)
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege('${role}','play_publish_editorial_draft(uuid,integer,uuid,text,text)','EXECUTE') allowed`)).rows[0].allowed,false)
 }finally{await db.close()}
})
