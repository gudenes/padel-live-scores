// Run: node --test scripts/test-play-settlement.mjs (isolated embedded Postgres).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const [season,template,match,market,user,loser]=[1,2,3,4,5,6].map(uuid)
async function setup(){
 const db=new PGlite()
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid';
 CREATE TABLE users(id uuid primary key); CREATE TABLE profiles(id uuid primary key);
 CREATE TABLE tournaments(id uuid primary key);
 CREATE TABLE matches(id uuid primary key,status text,winner_pair integer);
 INSERT INTO users VALUES('${user}'),('${loser}'); INSERT INTO profiles SELECT * FROM users;`)
 for(const f of ['20260923120000_play_market_core.sql','20260923120100_play_market_trading.sql','20260923120200_play_market_ledger.sql','20260418_user_notifications.sql','20260927160000_play_atomic_settlement.sql']){
   const sql=(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8')).replace("encode(gen_random_bytes(8), 'hex')","gen_random_uuid()::text")
   await db.exec(sql)
 }
 await db.exec(`INSERT INTO market_seasons(id,name,starts_at,ends_at,status) VALUES('${season}','test',now(),now()+interval '1 day','active');
 INSERT INTO market_templates(id,key,question_i18n,horizon,trigger,lock_rule,resolver_key,seed_source)
 VALUES('${template}','test','{}','pre-match','test','match_start','match.winner_is_pair','fixed');
 INSERT INTO matches VALUES('${match}','live',null);
 INSERT INTO markets(id,season_id,template_id,match_id,resolver_key,resolver_params,lmsr_b,seed_prob,seed_source,locks_at)
 VALUES('${market}','${season}','${template}','${match}','match.winner_is_pair','{"pair":1}',1000,.5,'fixed',now()+interval '1 day');
 INSERT INTO user_guaca_balance(user_id,season_id,balance) VALUES('${user}','${season}',900),('${loser}','${season}',900);
 INSERT INTO market_positions(market_id,user_id,yes_shares,no_shares,cost_basis)
 VALUES('${market}','${user}',153.9,0,100),('${market}','${loser}',0,140.7,100);`)
 return db
}
const scalar=async(db,sql)=>(await db.query(sql)).rows[0]
const settle=(db,outcome,revision=0)=>db.query(`SELECT play_settle_market($1,$2,'Verified test result','test',$3)`,[market,outcome,revision])

test('finish pays once, correction applies delta, spent payout becomes visible debt, void refunds and notifies',async()=>{
 const db=await setup();try{
 await db.exec(`UPDATE matches SET status='finished',winner_pair=1 WHERE id='${match}'`)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${user}'`)).balance,1053)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${loser}'`)).balance,900)
 assert.equal((await scalar(db,`SELECT status FROM markets WHERE id='${market}'`)).status,'settled')
 await settle(db,'yes');await settle(db,'yes')
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM guaca_ledger')).n,2)
 await db.exec(`UPDATE user_guaca_balance SET balance=10 WHERE user_id='${user}'; UPDATE matches SET winner_pair=2 WHERE id='${match}'`)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${user}'`)).balance,-143)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${loser}'`)).balance,1040)
 assert.equal((await scalar(db,`SELECT settlement_revision FROM markets WHERE id='${market}'`)).settlement_revision,2)
 await assert.rejects(settle(db,'void',1),/settlement_conflict/)
 await settle(db,'void',2)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${loser}'`)).balance,1000)
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM user_notifications')).n,6)
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM play_result_notices WHERE corrected')).n,4)
 }finally{await db.close()}
})
test('missing winner waits; missing wallet rolls everything back and preserves result ingestion for retry',async()=>{
 const db=await setup();try{
 await db.exec(`UPDATE matches SET status='finished' WHERE id='${match}'`)
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM guaca_ledger')).n,0)
 await db.exec(`DELETE FROM user_guaca_balance WHERE user_id='${loser}'; UPDATE matches SET winner_pair=1 WHERE id='${match}'`)
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM guaca_ledger')).n,0)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${user}'`)).balance,900)
 assert.equal((await scalar(db,"SELECT count(*)::int AS n FROM market_audit_log WHERE action='settlement_failed'")).n,1)
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM market_settlement_retries')).n,1)
 await db.exec(`INSERT INTO user_guaca_balance(user_id,season_id,balance) VALUES('${loser}','${season}',900)`)
 await settle(db,'yes');assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM market_payouts')).n,2)
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM market_settlement_retries')).n,0)
 }finally{await db.close()}
})
test('atomic trade refuses stale quote and finished market, commits all rows together',async()=>{
 const db=await setup();try{
 const q={side:'yes',direction:'buy',shares:10,cash:-6,price:.6,oldYes:0,oldNo:0,newYes:10,newNo:0,heldYes:153.9,heldNo:0,oldBasis:100,positionYes:163.9,positionNo:0,basis:106,pnl:0,positionCount:2}
 const trade=()=>db.query('SELECT play_commit_trade($1,$2,$3)',[market,user,q])
 await trade();assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM market_trades')).n,1)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${user}'`)).balance,894)
 await assert.rejects(trade(),/market_busy/)
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM guaca_ledger')).n,1)
 await db.exec(`UPDATE matches SET status='finished',winner_pair=1 WHERE id='${match}'`)
 await assert.rejects(trade(),/market_not_open/)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${user}'`)).balance,1057)
 }finally{await db.close()}
})

test('a ledger failure rolls back the entire trade; public roles cannot call settlement',async()=>{
 const db=await setup();try{
 await db.exec("ALTER TABLE guaca_ledger ADD CONSTRAINT test_failure CHECK(kind<>'trade_buy')")
 const q={side:'yes',direction:'buy',shares:10,cash:-6,price:.6,oldYes:0,oldNo:0,newYes:10,newNo:0,heldYes:153.9,heldNo:0,oldBasis:100,positionYes:163.9,positionNo:0,basis:106,pnl:0,positionCount:2}
 await assert.rejects(db.query('SELECT play_commit_trade($1,$2,$3)',[market,user,q]),/test_failure/)
 assert.equal((await scalar(db,'SELECT q_yes::float AS q FROM markets')).q,0)
 assert.equal((await scalar(db,`SELECT balance FROM user_guaca_balance WHERE user_id='${user}'`)).balance,900)
 assert.equal((await scalar(db,'SELECT count(*)::int AS n FROM market_trades')).n,0)
 for (const role of ['anon','authenticated']) {
   const r=await scalar(db,`SELECT has_function_privilege('${role}','play_settle_market(uuid,text,text,text,integer)','EXECUTE') AS allowed`)
   assert.equal(r.allowed,false)
 }
 }finally{await db.close()}
})

test('withdrawn result is held for review; replays cannot repay; legacy payouts require reconciliation',async()=>{
 const db=await setup();try{
 await db.exec(`UPDATE matches SET status='finished',winner_pair=1 WHERE id='${match}'; UPDATE matches SET status='live',winner_pair=null WHERE id='${match}'`)
 assert.equal((await scalar(db,'SELECT status FROM markets')).status,'held')
 await db.exec(`UPDATE matches SET status='finished',winner_pair=2 WHERE id='${match}'`)
 assert.equal((await scalar(db,'SELECT settlement_revision AS revision FROM markets')).revision,1)
 await settle(db,'no',1)
 assert.equal((await scalar(db,'SELECT settlement_revision AS revision FROM markets')).revision,2)
 }finally{await db.close()}
 const legacy=await setup();try{
 await legacy.exec(`INSERT INTO guaca_ledger(user_id,season_id,kind,amount,market_id) VALUES('${user}','${season}','settlement',153,'${market}')`)
 await assert.rejects(settle(legacy,'yes'),/legacy_payout_requires_reconciliation/)
 }finally{await legacy.close()}
})
