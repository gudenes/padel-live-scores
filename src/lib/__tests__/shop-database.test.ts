import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import {beforeAll,afterAll,it,expect} from 'vitest'
const db=new PGlite()
const u='00000000-0000-4000-8000-000000000001',season='00000000-0000-4000-8000-000000000002'
async function call(action:string,item:string|null=null,avatar:string|null=null,user=u){const r=await db.query<{state:{balance:number;owned:string[];avatar:string;wins:number;equipped:Record<string,string>}}>('select play_shop_update($1,$2,$3,$4,$5) as state',[user,season,action,item,avatar]);return r.rows[0].state}
beforeAll(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA storage;
 CREATE TABLE profiles(id uuid primary key);CREATE TABLE market_seasons(id uuid primary key);
 CREATE TABLE play_access(user_id uuid primary key);CREATE TABLE user_guaca_balance(user_id uuid,season_id uuid,balance integer,updated_at timestamptz,PRIMARY KEY(user_id,season_id));
 CREATE TABLE guaca_ledger(user_id uuid,season_id uuid,kind text,amount integer,memo text);
 CREATE TABLE markets(id uuid primary key,status text,settled_at timestamptz,settlement_revision integer);
 CREATE TABLE market_positions(user_id uuid,market_id uuid,cost_basis integer);
 CREATE TABLE market_payouts(user_id uuid,market_id uuid,revision integer,yes_paid integer,no_paid integer);
 CREATE TABLE storage.objects(bucket_id text,name text);
 INSERT INTO profiles VALUES('${u}');INSERT INTO market_seasons VALUES('${season}');INSERT INTO play_access VALUES('${u}');INSERT INTO user_guaca_balance VALUES('${u}','${season}',1000,now());`)
 await db.exec(readFileSync('supabase/migrations/20260929120000_play_cosmetic_shop.sql','utf8'))
},30000)
afterAll(()=>db.close())
it('rejects callers outside the whitelist',async()=>{await expect(call('read',null,null,season)).rejects.toThrow('not_found')})
it('debits once and persists the owned and equipped item on retry',async()=>{
 const first=await call('buy','hat-club');expect(first.balance).toBe(650);expect(first.equipped.hat).toBe('hat-club')
 expect((await call('buy','hat-club')).balance).toBe(650)
 expect((await db.query('select * from guaca_ledger')).rows).toHaveLength(1)
})
it('rejects locked, unowned and unaffordable items without altering the balance',async()=>{
 await expect(call('buy','hat-champion')).rejects.toThrow('performance_locked')
 await expect(call('equip','shoes-club')).rejects.toThrow('not_owned')
 await call('buy','shoes-cobalt')
 await expect(call('buy','hat-backwards')).rejects.toThrow('insufficient_balance')
 expect((await call('read')).balance).toBe(150)
})
it('validates avatar ownership and persists preset selection',async()=>{
 await expect(call('avatar',null,`custom:${season}`)).rejects.toThrow('invalid_avatar')
 expect((await call('avatar',null,'face-02')).avatar).toBe('face-02')
 expect((await call('read')).avatar).toBe('face-02')
})
it('counts only profitable settled results with matching revisions',async()=>{
 await db.exec(`INSERT INTO markets VALUES('${season}','settled',now(),2);INSERT INTO market_positions VALUES('${u}','${season}',100);INSERT INTO market_payouts VALUES('${u}','${season}',1,200,0);`)
 expect((await call('read')).wins).toBe(0)
 await db.exec('UPDATE market_payouts SET revision=2')
 expect((await call('read')).wins).toBe(1)
})
