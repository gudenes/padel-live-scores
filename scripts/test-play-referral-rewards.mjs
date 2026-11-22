// Isolated PostgreSQL: never connects to the application's database.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
async function setup(){
 const db=new PGlite()
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE profiles(id uuid PRIMARY KEY);
 CREATE TABLE market_seasons(id uuid PRIMARY KEY,status text,reset_balance integer);
 CREATE TABLE play_access(user_id uuid PRIMARY KEY REFERENCES profiles(id),granted_by text,note text);
 CREATE TABLE play_member_follows(follower_id uuid,following_id uuid,PRIMARY KEY(follower_id,following_id));
 CREATE TABLE user_guaca_balance(user_id uuid,season_id uuid,balance integer,locked integer DEFAULT 0,updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,season_id));
 CREATE TABLE guaca_ledger(user_id uuid,season_id uuid,kind text,amount integer,memo text);
 INSERT INTO profiles VALUES('${id(1)}'),('${id(2)}'),('${id(3)}');
 INSERT INTO market_seasons VALUES('${id(9)}','active',10000);
 INSERT INTO play_access(user_id) VALUES('${id(1)}');`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261122210000_play_referral_rewards.sql',import.meta.url),'utf8'))
 return db
}
const accept=(db,user=2,host=1)=>db.query('SELECT play_accept_friend_invitation($1,$2) AS added',[id(user),id(host)])
test('both receive 500; retries, self invitations and re-grants cannot duplicate rewards',async()=>{
 const db=await setup();try{
 assert.equal((await accept(db)).rows[0].added,true)
 assert.deepEqual((await db.query('SELECT balance FROM user_guaca_balance ORDER BY user_id')).rows,[{balance:10500},{balance:10500}])
 assert.equal((await accept(db)).rows[0].added,false)
 assert.equal((await accept(db,1,1)).rows[0].added,false)
 await db.exec(`DELETE FROM play_access WHERE user_id='${id(2)}'; INSERT INTO play_access(user_id) VALUES('${id(3)}')`)
 await accept(db,2,3)
 assert.equal((await db.query("SELECT count(*)::int AS n FROM guaca_ledger WHERE kind='referral'")).rows[0].n,2)
 assert.equal((await db.query('SELECT count(*)::int AS n FROM play_referral_rewards')).rows[0].n,1)
 }finally{await db.close()}
})
test('existing members and invalid inviters receive no bonus',async()=>{
 const db=await setup();try{
 await assert.rejects(accept(db,2,99),/invalid_invitation/)
 await db.exec(`INSERT INTO play_access(user_id) VALUES('${id(2)}')`)
 assert.equal((await accept(db)).rows[0].added,false)
 assert.equal((await db.query('SELECT count(*)::int AS n FROM guaca_ledger')).rows[0].n,0)
 }finally{await db.close()}
})
test('credits existing wallets without resetting them and ledger totals match',async()=>{
 const db=await setup();try{
 await db.exec(`INSERT INTO user_guaca_balance(user_id,season_id,balance) VALUES('${id(1)}','${id(9)}',1234);
 INSERT INTO guaca_ledger VALUES('${id(1)}','${id(9)}','signup_grant',1234,'fixture')`)
 await accept(db)
 await accept(db,3)
 assert.equal((await db.query(`SELECT balance FROM user_guaca_balance WHERE user_id='${id(1)}'`)).rows[0].balance,2234)
 assert.equal((await db.query('SELECT count(*)::int AS n FROM user_guaca_balance b WHERE balance != (SELECT sum(amount) FROM guaca_ledger l WHERE l.user_id=b.user_id AND l.season_id=b.season_id)')).rows[0].n,0)
 }finally{await db.close()}
})
test('failure rolls back access, connections and rewards together',async()=>{
 const db=await setup();try{
 await db.exec("ALTER TABLE guaca_ledger ADD CHECK(kind != 'referral')")
 await assert.rejects(accept(db))
 assert.equal((await db.query('SELECT count(*)::int AS n FROM play_access')).rows[0].n,1)
 for(const table of ['play_member_follows','play_referral_rewards','user_guaca_balance','guaca_ledger']) assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0)
 }finally{await db.close()}
})

test('public accounts can invite without an allowlist grant',async()=>{const db=await setup();try{assert.equal((await accept(db,2,3)).rows[0].added,true);assert.equal((await db.query("SELECT count(*)::int AS n FROM guaca_ledger WHERE kind='referral'")).rows[0].n,2)}finally{await db.close()}})
