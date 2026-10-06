import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
async function setup(){
 const db=new PGlite()
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid';
 CREATE TABLE users(id uuid primary key); CREATE TABLE profiles(id uuid primary key); CREATE TABLE tournaments(id uuid primary key);
 CREATE TABLE matches(id uuid primary key,tournament_id uuid,status text,winner_pair integer,scheduled_at timestamptz,category text DEFAULT 'men',round_canonical text DEFAULT 'R16',
 pair1_player1_id uuid,pair1_player2_id uuid,pair2_player1_id uuid,pair2_player2_id uuid,pred_pair1_prob numeric,pred_model_version text,pred_computed_at timestamptz);
 CREATE TABLE players(id uuid primary key,name text,display_name text,avatar_url text,country text);
 CREATE TABLE model_predictions(id uuid default gen_random_uuid(),match_id uuid, pair1_prob numeric);
 INSERT INTO users VALUES('${uuid(1)}');INSERT INTO profiles SELECT * FROM users;INSERT INTO tournaments VALUES('${uuid(2)}');`)
 for(const f of ['20260923120000_play_market_core.sql','20260923120100_play_market_trading.sql','20260923120200_play_market_ledger.sql','20260418_user_notifications.sql','20260927160000_play_atomic_settlement.sql','20260929170000_play_editorial_scopes.sql','20260929190000_play_editorial_publishing.sql','20260929210000_play_editorial_contract_uniqueness.sql','20261004110000_play_champion_editorial.sql','20261005090000_play_predraw_deadlines.sql','20261006100000_play_lineup_safety.sql'])
  await db.exec((await readFile(`supabase/migrations/${f}`,'utf8')).replace("encode(gen_random_bytes(8), 'hex')","gen_random_uuid()::text"))
 await db.exec(`INSERT INTO market_seasons(id,name,starts_at,ends_at,status) VALUES('${uuid(3)}','test',now()-interval '1 day',now()+interval '90 days','active');
 INSERT INTO matches(id,tournament_id,status,scheduled_at,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id) VALUES('${uuid(4)}','${uuid(2)}','scheduled',now()+interval '1 day','${uuid(5)}','${uuid(6)}','${uuid(7)}','${uuid(8)}');
 INSERT INTO market_templates(id,key,question_i18n,horizon,trigger,lock_rule,resolver_key,seed_source) VALUES('${uuid(9)}','test.winner','{"en":"Win?"}','pre-match','test','match_start','match.winner_is_pair','elo');
 INSERT INTO user_guaca_balance(user_id,season_id,balance) VALUES('${uuid(1)}','${uuid(3)}',1000);`)
 await predict(db)
 return db
}
const state=async db=>(await db.query('select * from matches')).rows[0]
const market=async(db,id)=>(await db.query('select * from markets where id=$1',[id])).rows[0]
async function predict(db){await db.exec("update matches set pred_pair1_prob=.7,pred_lineup_fingerprint=lineup_fingerprint,pred_model_version='test',pred_computed_at=now(),lineup_prediction_pending=false")}
async function publish(db,key){const k=key??(await state(db)).lineup_fingerprint;return (await db.query(`insert into markets(season_id,template_id,match_id,category,resolver_key,resolver_params,lmsr_b,seed_prob,seed_source,q_yes,q_no,status,locks_at,lineup_fingerprint) values($1,$2,$3,'men','match.winner_is_pair','{"pair":1}',100,.7,'elo',0,0,'open',now()+interval '20 hours',$4) returning id`,[uuid(3),uuid(9),uuid(4),k])).rows[0].id}
const quote={side:'yes',direction:'buy',shares:10,cash:-7,price:.7,oldYes:0,oldNo:0,newYes:10,newNo:0,heldYes:0,heldNo:0,oldBasis:0,positionYes:10,positionNo:0,basis:7,pnl:0,positionCount:1}
async function reconcile(db){const r=(await db.query('select play_reconcile_lineup_markets() r')).rows[0].r;assert.equal(r.errors,0);return r}

test('withdrawal pauses immediately, blocks stale trade/settlement, refunds exactly once, replacement creates a distinct market',async()=>{
 const db=await setup();try{
 const id=await publish(db),old=(await state(db)).lineup_fingerprint
 await db.query('select play_commit_trade($1,$2,$3)',[id,uuid(1),quote])
 await db.exec(`update matches set pair1_player1_id=null,pair1_player2_id=null,lineup_withdrawal_confirmed=true`)
 assert.equal((await market(db,id)).status,'held');assert.equal((await state(db)).pred_pair1_prob,null)
 await assert.rejects(db.query('select play_commit_trade($1,$2,$3)',[id,uuid(1),quote]),/market_not_open/)
 await assert.rejects(db.query("select play_settle_market($1,'yes','result','test',0)",[id]),/lineup_changed/)
 await reconcile(db);await reconcile(db)
 assert.equal((await market(db,id)).status,'void')
 assert.equal((await db.query('select balance from user_guaca_balance')).rows[0].balance,1000)
 assert.equal((await db.query("select count(*) n from guaca_ledger where kind='refund'")).rows[0].n,1)
 await assert.rejects(publish(db,old),/lineup_incomplete/)
 await db.exec(`update matches set pair1_player1_id='${uuid(10)}',pair1_player2_id='${uuid(11)}'`)
 await assert.rejects(publish(db,old),/lineup_changed/)
 await assert.rejects(publish(db),/lineup_prediction_pending/)
 await predict(db);const replacement=await publish(db);assert.notEqual(replacement,id)
 assert.equal((await market(db,replacement)).status,'open')
 await assert.rejects(publish(db),/duplicate_market/)
 await db.exec("update matches set status='finished',winner_pair=1")
 assert.equal((await market(db,id)).status,'void')
 assert.equal((await db.query('select count(*) n from market_settlement_retries')).rows[0].n,0)
 }finally{await db.close()}
})
test('temporary gap restores same lineup only after fresh prediction; teammate ordering is not a change',async()=>{
 const db=await setup();try{
 const id=await publish(db),k=(await state(db)).lineup_fingerprint
 await db.exec(`update matches set pair1_player1_id='${uuid(6)}',pair1_player2_id='${uuid(5)}'`)
 assert.equal((await market(db,id)).status,'open');assert.equal((await state(db)).lineup_fingerprint,k)
 await db.exec('update matches set pair1_player1_id=null')
 await reconcile(db);assert.equal((await market(db,id)).status,'held')
 await db.exec(`update matches set pair1_player1_id='${uuid(6)}'`)
 await reconcile(db);assert.equal((await market(db,id)).status,'held')
 await predict(db);await reconcile(db);assert.equal((await market(db,id)).status,'open')
 }finally{await db.close()}
})
test('direct replacement voids, old model output cannot overwrite current lineup, operator holds are preserved',async()=>{
 const db=await setup();try{
 const id=await publish(db),old=(await state(db)).lineup_fingerprint
 await db.query('insert into model_predictions(match_id,pair1_prob,lineup_fingerprint) values($1,.7,$2)',[uuid(4),old])
 await db.exec(`update matches set pair1_player1_id='${uuid(10)}'`)
 assert.equal((await db.query('select lineup_valid from model_predictions')).rows[0].lineup_valid,false)
 await db.query('insert into model_predictions(match_id,pair1_prob,lineup_fingerprint) values($1,.7,$2)',[uuid(4),old])
 assert.equal((await db.query('select count(*) n from model_predictions')).rows[0].n,1)
 await db.query('update matches set pred_pair1_prob=.7,pred_lineup_fingerprint=$1',[old])
 assert.equal((await state(db)).pred_pair1_prob,null)
 await reconcile(db);assert.equal((await market(db,id)).status,'void')
 await predict(db);const next=await publish(db)
 await db.query("update markets set status='held',hold_reason='operator: review' where id=$1",[next])
 await db.exec(`update matches set pair1_player1_id='${uuid(11)}'`)
 await reconcile(db);assert.equal((await market(db,next)).hold_reason,'operator: review')
 }finally{await db.close()}
})
test('duplicate participants and unknown lineups cannot publish even fixed-price questions',async()=>{
 const db=await setup();try{
 await db.exec(`update matches set pair1_player1_id='${uuid(7)}'`)
 assert.equal((await state(db)).lineup_fingerprint,null)
 await assert.rejects(publish(db,'old'),/lineup_incomplete/)
 }finally{await db.close()}
})

test('match-bound editorial contracts can be replaced while retaining duplicate protection',async()=>{
 const db=await setup();try{
 const insert=async()=> (await db.query(`insert into markets(season_id,template_id,editorial_scope,bound_match_id,category,resolver_key,resolver_params,lmsr_b,seed_prob,seed_source,q_yes,q_no,status,locks_at,lineup_fingerprint)
 values($1,$2,'match-editorial',$3,'men','match.winner_is_pair','{"pair":1}',100,.7,'elo',0,0,'open',now()+interval '20 hours',$4) returning id`,[uuid(3),uuid(9),uuid(4),(await state(db)).lineup_fingerprint])).rows[0].id
 const id=await insert()
 await db.exec(`update matches set pair1_player1_id='${uuid(10)}'`)
 await reconcile(db);assert.equal((await market(db,id)).status,'void')
 await predict(db);assert.notEqual(await insert(),id)
 await assert.rejects(insert(),/duplicate_market/)
 }finally{await db.close()}
})
